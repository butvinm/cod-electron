import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPermissionHost } = require('../../src/agents/permission-host.cjs');
const { Chats } = require('../../src/agents/chats.cjs');
const { createChat, reduce, statusOf, permissionText } = require('../../src/renderer/chat-model.js');

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
  assert.equal(reduce(state, { type: 'permission-answered' }).permission, null);
  for (const type of ['turn-end', 'interrupted', 'error']) assert.equal(reduce(state, { type }).permission, null);
  assert.equal(statusOf(createChat()), 'Ready');
});
