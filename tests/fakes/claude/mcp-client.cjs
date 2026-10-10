'use strict';
// MCP wire details and permission payload fields are inferred. See README.md.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

async function connect(argv, log) {
  const flag = name => argv[argv.indexOf(name) + 1];
  const tool = flag('--permission-prompt-tool');
  const source = flag('--mcp-config');
  const config = JSON.parse(source.trim().startsWith('{') ? source : fs.readFileSync(source, 'utf8'));
  const entries = Object.entries(config.mcpServers || {});
  const match = entries.filter(([name]) => tool.startsWith(`mcp__${name}__`));
  const [serverName, server] = match.length === 1 ? match[0] : entries.length === 1 ? entries[0] : [];
  if (!server) throw new Error('Cannot resolve permission tool MCP server');
  const localTool = tool.startsWith(`mcp__${serverName}__`) ? tool.slice(`mcp__${serverName}__`.length) : tool;
  let nextId = 0;
  let close = () => {};
  let send;
  let protocol = '2024-11-05';
  if (!server.type || server.type === 'stdio') {
    if (server.url || typeof server.command !== 'string') throw new Error('Invalid stdio MCP config');
    const child = spawn(server.command, server.args || [], { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    const fail = error => { for (const item of pending.values()) item.reject(error); pending.clear(); };
    child.on('error', fail);
    child.on('exit', () => fail(new Error('MCP server exited before answering')));
    child.stderr.resume(); // Never copy potential server secrets to fixture logs.
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.method && message.id !== undefined) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\n');
        } else if (pending.has(message.id)) {
          const item = pending.get(message.id); pending.delete(message.id);
          if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
        }
      } catch (error) { fail(error); }
    });
    send = message => new Promise((resolve, reject) => {
      if (message.id !== undefined) pending.set(message.id, { resolve, reject });
      child.stdin.write(JSON.stringify(message) + '\n', error => { if (error) reject(error); else if (message.id === undefined) resolve(); });
    });
    close = () => { lines.close(); child.stdin.end(); child.kill(); fail(new Error('MCP connection closed')); };
    log({ kind: 'mcp-connect', server: serverName, transport: 'stdio', serverPid: child.pid });
  } else if (server.type === 'http') {
    const url = new URL(server.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Fake MCP must use a loopback server');
    let sessionId;
    send = async message => {
      const headers = { ...server.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
      if (message.method !== 'initialize') headers['MCP-Protocol-Version'] = protocol;
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
      sessionId = response.headers.get('mcp-session-id') || sessionId;
      if (message.id === undefined) { await response.body?.cancel(); return; }
      let wire;
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        try {
          while (!wire) {
            const chunk = await reader.read(); if (chunk.done) throw new Error('MCP SSE ended before response');
            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (data) { const item = JSON.parse(data); if (item.id === message.id) wire = item; }
            }
          }
        } finally { await reader.cancel(); }
      } else wire = await response.json();
      if (wire.error) throw new Error(JSON.stringify(wire.error));
      return wire.result;
    };
    log({ kind: 'mcp-connect', server: serverName, transport: 'http' });
  } else throw new Error(`Unsupported fake MCP transport: ${server.type}`);
  const rpc = async (method, params, notification = false) => {
    let timer;
    try {
      return await Promise.race([
        send({ jsonrpc: '2.0', ...(notification ? {} : { id: ++nextId }), method, params }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 15000); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  try {
    const init = await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'cod-scripted-claude', version: '1' } });
    protocol = init.protocolVersion;
    await rpc('notifications/initialized', {}, true);
    const listed = await rpc('tools/list', {});
    if (!listed.tools?.some(entry => entry.name === localTool)) throw new Error('Named permission tool is missing from tools/list');
    return {
      close,
      async permission(request) {
        log({ kind: 'permission-request', tool, localTool, request });
        const result = await rpc('tools/call', { name: localTool, arguments: request });
        if (result.isError) throw new Error('Permission MCP tool returned isError');
        const answer = JSON.parse(result.content?.find(item => item.type === 'text')?.text || 'null');
        if (!answer || !['allow', 'deny'].includes(answer.behavior)) throw new Error('Invalid permission answer behavior');
        if (answer.behavior === 'allow' && (!answer.updatedInput || typeof answer.updatedInput !== 'object')) throw new Error('Allow needs updatedInput');
        if (answer.behavior === 'deny' && typeof answer.message !== 'string') throw new Error('Deny needs message');
        log({ kind: 'permission-answer', tool, request, answer });
        return answer;
      },
    };
  } catch (error) { close(); throw error; }
}
module.exports = { connect };
