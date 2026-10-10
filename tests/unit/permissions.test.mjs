import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPermissionHost } = require('../../src/agents/permission-host.cjs');
const { Chats } = require('../../src/agents/chats.cjs');
const { createClaudeProvider } = require('../../src/agents/claude.cjs');
const { createChat, reduce, statusOf, permissionText, queueHint, promptFocusTarget } = require('../../src/renderer/chat-model.js');

async function rpc(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, json: response.status === 200 ? await response.json() : null };
}

test('permission host: lists one tool and relays a call to the registered handler', async () => {
  const host = createPermissionHost();
  await host.ready;
  const seen = [];
  const registration = host.register(async request => { seen.push(request); return { behavior: 'allow', updatedInput: request.input }; });
  const url = JSON.parse(registration.config).mcpServers.cod.url;
  assert.equal(registration.tool, 'mcp__cod__approve');
  const init = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.json.result.protocolVersion, '2025-03-26');
  assert.equal((await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const listed = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(listed.json.result.tools.map(tool => tool.name), ['approve']);
  const call = await rpc(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'ls' } } } });
  assert.deepEqual(JSON.parse(call.json.result.content[0].text), { behavior: 'allow', updatedInput: { command: 'ls' } });
  assert.equal(seen[0].tool_name, 'Bash');
  const bad = await rpc(url, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'approve', arguments: {} } });
  assert.equal(bad.json.error.code, -32602);
  registration.unregister();
  assert.equal((await rpc(url, { jsonrpc: '2.0', id: 5, method: 'ping' })).status, 404);
  await host.close();
});

function fakeProvider() {
  const answers = [];
  const provider = {
    start(options) {
      const session = { alive: true, interrupting: false, send() {}, close() {}, interrupt() {}, answerPermission: (id, answer) => answers.push([id, answer]) };
      provider.options = options;
      return session;
    },
  };
  return { provider, answers };
}

test('Chats: allow for this session answers the same request again without asking', () => {
  const { provider, answers } = fakeProvider();
  const emitted = [];
  const chats = new Chats({ provider, folders: { list: () => [] }, emit: (_id, event) => emitted.push(event), home: '/h' });
  chats.send('w', 'go');
  const ask = (id, command) => provider.options.onEvent({ type: 'permission-request', id, tool: 'Bash', input: { command } });
  ask('r1', 'ls');
  assert.equal(emitted.length, 1);
  chats.answerPermission('w', 'r1', { allow: true, scope: 'session' });
  assert.deepEqual(answers, [['r1', { allow: true, message: undefined }]]);
  ask('r2', 'ls');
  assert.equal(emitted.length, 1, 'no second prompt');
  assert.deepEqual(answers[1], ['r2', { allow: true }]);
  ask('r3', 'rm x');
  assert.equal(emitted.length, 2, 'a different input prompts');
  chats.answerPermission('w', 'r3', { allow: true, scope: 'once' });
  ask('r4', 'rm x');
  assert.equal(emitted.length, 3, 'allow once is not remembered');
});

test('chat model: a pending request means needs input and every turn ending clears it', () => {
  let state = reduce(createChat(), { type: 'user-message', text: 'hi' });
  assert.equal(statusOf(state), 'Working');
  state = reduce(state, { type: 'permission-request', id: 'a', tool: 'Bash', input: { command: 'ls' } });
  assert.equal(statusOf(state), 'Needs input');
  assert.equal(permissionText(state.permission.input), 'ls');
  assert.equal(reduce(state, { type: 'permission-clear', id: 'other' }).permission.id, 'a');
  assert.equal(reduce(state, { type: 'permission-answered', id: 'a' }).permission, null);
  for (const type of ['turn-end', 'interrupted', 'error']) assert.equal(reduce(state, { type }).permission, null);
  assert.equal(statusOf(createChat()), 'Ready');
});

test('chat model: requests queue in order and needs input lasts until the queue is empty', () => {
  const ask = (state, id) => reduce(state, { type: 'permission-request', id, tool: 'Bash', input: { command: id } });
  let state = ask(ask(ask(createChat(), 'a'), 'b'), 'c');
  assert.equal(state.permission.id, 'a');
  assert.equal(queueHint(state.permissions.length), '1 of 3');
  state = reduce(state, { type: 'permission-answered', id: 'a' });
  assert.equal(state.permission.id, 'b');
  assert.equal(statusOf(state), 'Needs input');
  state = reduce(state, { type: 'permission-clear', id: 'c' });
  assert.equal(queueHint(state.permissions.length), '');
  state = reduce(state, { type: 'permission-clear', id: 'b' });
  assert.equal(state.permission, null);
  assert.equal(statusOf(state), 'Ready');
  assert.deepEqual(reduce(ask(ask(createChat(), 'a'), 'b'), { type: 'turn-end' }).permissions, []);
});

test('chat model: focus goes to the current choice, or to the denial form when it is open', () => {
  assert.deepEqual(promptFocusTarget({ denying: true, choice: 1, count: 3 }), { kind: 'reason' });
  assert.deepEqual(promptFocusTarget({ denying: false, choice: 2, count: 3 }), { kind: 'choice', index: 2 });
  assert.deepEqual(promptFocusTarget({ denying: false, choice: 9, count: 3 }), { kind: 'choice', index: 2 });
  assert.deepEqual(promptFocusTarget({ denying: false, choice: undefined, count: 3 }), { kind: 'choice', index: 0 });
});

function raw(url, headers) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: target.port, path: target.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  });
}

test('permission host: a hostile Origin is refused, no Origin passes, a wrong Host is refused', async () => {
  const host = createPermissionHost();
  await host.ready;
  const registration = host.register(async () => ({ behavior: 'deny', message: 'x' }));
  const url = JSON.parse(registration.config).mcpServers.cod.url;
  assert.equal(await raw(url, {}), 200);
  assert.equal(await raw(url, { Origin: 'https://evil.example' }), 403);
  assert.equal(await raw(url, { Origin: 'null' }), 403);
  assert.equal(await raw(url, { Origin: `http://localhost:${host.port}` }), 200);
  assert.equal(await raw(url, { Host: 'evil.example' }), 404);
  await host.close();
});

test('claude provider: a spawn failure unregisters the permission endpoint', async () => {
  const provider = createClaudeProvider({ bin: '/nonexistent/cod-claude' });
  await provider.ready;
  const events = [];
  provider.start({ cwd: process.cwd(), onEvent: event => events.push(event.type), onExit: () => {} });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(events.includes('error'));
  assert.equal(provider.endpointCount(), 0);
  await provider.close();
});
