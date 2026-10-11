import http from 'node:http';
import crypto from 'node:crypto';

// A tiny local MCP server with one tool. Claude is started with --permission-prompt-tool
// pointing at it, and calls the tool each time it needs an answer for a tool use.
//
// Transport: Streamable HTTP on the loopback interface, plain JSON responses. Only the few
// JSON-RPC messages Claude needs are handled: initialize, ping, tools/list, tools/call.
// Each Claude process gets its own secret path, so a request is tied to one chat session.
//
// Tool input (from Claude):  { tool_name, input, tool_use_id? }
// Tool result (from us):     one text content item holding JSON, either
//   { behavior: 'allow', updatedInput }  or  { behavior: 'deny', message }

const SERVER_NAME = 'cod';
const TOOL_NAME = 'approve';
export const QUALIFIED_TOOL = `mcp__${SERVER_NAME}__${TOOL_NAME}`;
const MAX_BODY = 1024 * 1024;

const TOOL = {
  name: TOOL_NAME,
  description: 'Asks the person using Cod whether Claude may use a tool.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string', description: 'The tool that needs permission' },
      input: { type: 'object', description: 'The input of that tool', additionalProperties: true },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

// A permission request as it reaches the handler.
export interface PermissionRequest {
  tool_name: string;
  input: object;
  tool_use_id?: string;
  rpcId: JsonRpcId;
}

export type PermissionReply =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string };

export type PermissionHandler = (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionReply>;

export interface Registration {
  config: string;
  tool: string;
  unregister: () => void;
}

export interface PermissionHost {
  ready: Promise<number | null>;
  readonly port: number | null;
  count: () => number;
  // Registers a handler for one Claude process. Returns the MCP config for it, or null
  // when the server is not listening.
  register(handler: PermissionHandler): Registration | null;
  close(): Promise<void>;
}

type JsonRpcId = string | number | null | undefined;

interface JsonRpcMessage {
  id?: JsonRpcId;
  method?: unknown;
  params?: {
    protocolVersion?: unknown;
    name?: unknown;
    arguments?: { tool_name?: unknown; input?: unknown; tool_use_id?: unknown };
  };
}

export function createPermissionHost(): PermissionHost {
  const handlers = new Map<string, PermissionHandler>(); // secret path token -> handler
  let port: number | null = null;

  async function respond(message: JsonRpcMessage, token: string, signal: AbortSignal): Promise<object> {
    const { id, method, params } = message;
    const ok = (result: object) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    if (method === 'initialize') {
      const asked = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
      return ok({ protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: '1' } });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: [TOOL] });
    if (method === 'tools/call') {
      if (!params || params.name !== TOOL_NAME) return fail(-32602, 'Unknown tool');
      const args = params.arguments || {};
      if (typeof args.tool_name !== 'string' || !args.input || typeof args.input !== 'object') return fail(-32602, 'Bad permission request');
      const handler = handlers.get(token);
      let answer: PermissionReply;
      try {
        if (!handler) throw new Error('The session is gone');
        answer = await handler({
          tool_name: args.tool_name,
          input: args.input,
          tool_use_id: typeof args.tool_use_id === 'string' ? args.tool_use_id : undefined,
          rpcId: id,
        }, signal);
      } catch {
        answer = { behavior: 'deny', message: 'Cod could not ask for permission.' };
      }
      return ok({ content: [{ type: 'text', text: JSON.stringify(answer) }] });
    }
    return fail(-32601, 'Method not found');
  }

  const server = http.createServer((req, res) => {
    const match = /^\/mcp\/([0-9a-f]{32})$/.exec(req.url || '');
    const token = match && match[1];
    const send = (status: number, body?: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    // A browser page sends an Origin header; the CLI does not. Only a local origin passes.
    const origin = req.headers.origin;
    if (origin !== undefined && !new RegExp(`^http://(127\\.0\\.0\\.1|localhost)(:${port})?$`).test(origin)) return send(403);
    if (!token || !handlers.has(token) || req.headers.host !== `127.0.0.1:${port}`) return send(404);
    if (req.method !== 'POST') return send(405);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      let message: JsonRpcMessage | null;
      try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcMessage | null; } catch { return send(400); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return send(400);
      // Notifications and responses carry no id (or no method) and get no answer body.
      if (message.id === undefined || typeof message.method !== 'string') return send(202);
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const reply = await respond(message, token, controller.signal);
      if (!controller.signal.aborted) send(200, reply);
    });
  });

  server.unref(); // an idle listener must not keep the program alive
  const ready = new Promise<number | null>(resolve => {
    server.on('error', () => resolve(null));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      port = address !== null && typeof address === 'object' ? address.port : null;
      resolve(port);
    });
  });

  return {
    ready,
    get port() { return port; },
    count: () => handlers.size,
    register(handler) {
      if (port === null) return null;
      const token = crypto.randomBytes(16).toString('hex');
      handlers.set(token, handler);
      return {
        config: JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'http', url: `http://127.0.0.1:${port}/mcp/${token}` } } }),
        tool: QUALIFIED_TOOL,
        unregister: () => { handlers.delete(token); },
      };
    },
    close() {
      handlers.clear();
      return new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
    },
  };
}
