'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

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
const QUALIFIED_TOOL = `mcp__${SERVER_NAME}__${TOOL_NAME}`;
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

function createPermissionHost() {
  const handlers = new Map(); // secret path token -> handler(request, signal) -> Promise<answer>
  let port = null;

  async function respond(message, token, signal) {
    const { id, method, params } = message;
    const ok = result => ({ jsonrpc: '2.0', id, result });
    const fail = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
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
      let answer;
      try {
        answer = await handler({ tool_name: args.tool_name, input: args.input, tool_use_id: args.tool_use_id }, signal);
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
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    // A browser page sends an Origin header; the CLI does not. Only a local origin passes.
    const origin = req.headers.origin;
    if (origin !== undefined && !new RegExp(`^http://(127\\.0\\.0\\.1|localhost)(:${port})?$`).test(origin)) return send(403);
    if (!token || !handlers.has(token) || req.headers.host !== `127.0.0.1:${port}`) return send(404);
    if (req.method !== 'POST') return send(405);
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      let message;
      try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400); }
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
  const ready = new Promise(resolve => {
    server.on('error', () => resolve(null));
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(port); });
  });

  return {
    ready,
    get port() { return port; },
    count: () => handlers.size,
    // Registers a handler for one Claude process. Returns the MCP config for it, or null
    // when the server is not listening.
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
      return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
    },
  };
}

module.exports = { createPermissionHost, QUALIFIED_TOOL };
