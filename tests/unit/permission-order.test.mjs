import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createClaudeProvider } = require('../../src/agents/claude.cjs');

const WINDOW_MS = 30;

// Starts a provider session whose "claude" is a script that records its arguments and waits.
// arrivals lists { id, rpcId } in the order requests reached the server.
async function startSession(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-order-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const argvFile = path.join(dir, 'argv');
  const bin = path.join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvFile}"\nexec sleep 30\n`);
  chmodSync(bin, 0o755);
  const arrivals = [];
  const provider = createClaudeProvider({ bin, graceMs: 50, onArrival: arrival => arrivals.push(arrival) });
  t.after(() => provider.close());
  await provider.ready;
  const events = [];
  const session = provider.start({ cwd: dir, onEvent: event => events.push(event), onExit: () => {} });
  // Closing needs real timers, so they are restored first.
  t.after(async () => { mock.timers.reset(); await session.close(); });
  let args = [];
  for (let i = 0; i < 400 && !args.includes('--mcp-config'); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    try { args = readFileSync(argvFile, 'utf8').split('\n'); } catch { /* not written yet */ }
  }
  assert.ok(args.includes('--mcp-config'), 'the process was started with the MCP config');
  const url = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.cod.url;
  return { events, session, url, arrivals };
}

// Waits, without timers (they are replaced in these tests), until the condition holds. Bounded.
async function waitFor(condition, what) {
  for (let i = 0; i < 5000; i++) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${what}`);
}

function call(url, rpcId, command, signal) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command } } } }),
  }).then(async response => JSON.parse((await response.json()).result.content[0].text));
}

const requests = events => events.filter(event => event.type === 'permission-request');

// Sends id 2 and then id 1, each only after the previous one reached the server.
async function sendReversed(url, arrivals) {
  const second = call(url, 2, 'second');
  await waitFor(() => arrivals.length === 1, 'the first arrival');
  const first = call(url, 1, 'first');
  await waitFor(() => arrivals.length === 2, 'the second arrival');
  assert.deepEqual(arrivals.map(arrival => arrival.rpcId), [2, 1], 'the server received id 2 before id 1');
  return { first, second };
}

test('requests that arrive in reverse order are shown by JSON-RPC id, and only after the 30 ms window', async t => {
  const { events, url, arrivals } = await startSession(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const { first, second } = await sendReversed(url, arrivals);
  first.catch(() => {});
  second.catch(() => {});
  assert.equal(requests(events).length, 0, 'nothing is shown inside the window');
  mock.timers.tick(WINDOW_MS - 1);
  assert.equal(requests(events).length, 0, 'still inside the window');
  mock.timers.tick(1);
  assert.deepEqual(requests(events).map(event => event.input.command), ['first', 'second']);
});

test('a request cancelled before the flush is never shown', async t => {
  const { events, url, arrivals } = await startSession(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const controller = new AbortController();
  const cancelled = call(url, 1, 'cancelled', controller.signal);
  await waitFor(() => arrivals.length === 1, 'the cancelled request to arrive');
  const kept = call(url, 2, 'kept');
  kept.catch(() => {});
  await waitFor(() => arrivals.length === 2, 'the kept request to arrive');
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  await waitFor(() => events.some(event => event.type === 'permission-clear' && event.id === arrivals[0].id), 'the permission-clear of the cancelled request');
  assert.equal(requests(events).length, 0, 'nothing was shown yet');
  mock.timers.tick(WINDOW_MS);
  assert.deepEqual(requests(events).map(event => event.input.command), ['kept']);
  assert.equal(requests(events)[0].id, arrivals[1].id);
});

test('each answer goes back to its own request', async t => {
  const { events, session, url, arrivals } = await startSession(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const { first, second } = await sendReversed(url, arrivals);
  mock.timers.tick(WINDOW_MS);
  const [a, b] = requests(events);
  assert.equal(a.id, arrivals[1].id, 'the first shown is the one with id 1');
  assert.equal(b.id, arrivals[0].id);
  // Answer out of order: the second request is allowed first, then the first is denied.
  session.answerPermission(b.id, { allow: true });
  session.answerPermission(a.id, { allow: false, message: 'no thanks' });
  assert.deepEqual(await second, { behavior: 'allow', updatedInput: { command: 'second' } });
  assert.deepEqual(await first, { behavior: 'deny', message: 'no thanks' });
});
