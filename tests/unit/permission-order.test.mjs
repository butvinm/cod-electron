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
async function startSession(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-order-'));
  const argvFile = path.join(dir, 'argv');
  const bin = path.join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvFile}"\nexec sleep 30\n`);
  chmodSync(bin, 0o755);
  const provider = createClaudeProvider({ bin, graceMs: 50 });
  await provider.ready;
  const events = [];
  const session = provider.start({ cwd: dir, onEvent: event => events.push(event), onExit: () => {} });
  let args = [];
  for (let i = 0; i < 400 && !args.includes('--mcp-config'); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    try { args = readFileSync(argvFile, 'utf8').split('\n'); } catch { /* not written yet */ }
  }
  const url = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.cod.url;
  t.after(async () => { await session.close(); await provider.close(); rmSync(dir, { recursive: true, force: true }); });
  return { events, session, url };
}

// Lets pending network work run without using timers, which the tests replace.
async function settle() {
  for (let i = 0; i < 300; i++) await new Promise(resolve => setImmediate(resolve));
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

test('requests that arrive in reverse order are shown by JSON-RPC id, and only after the 30 ms window', async t => {
  const { events, session, url } = await startSession(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const second = call(url, 2, 'second');
  await settle();
  const first = call(url, 1, 'first');
  await settle();
  assert.equal(requests(events).length, 0, 'nothing is shown inside the window');
  mock.timers.tick(WINDOW_MS - 1);
  assert.equal(requests(events).length, 0, 'still inside the window');
  mock.timers.tick(1);
  assert.deepEqual(requests(events).map(event => event.input.command), ['first', 'second']);
  // Closing denies what is still open, so the calls settle. Real timers are needed to close.
  mock.timers.reset();
  session.close();
  await Promise.all([first, second]);
});

test('a request cancelled before the flush is never shown', async t => {
  const { events, session, url } = await startSession(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const controller = new AbortController();
  const cancelled = call(url, 1, 'cancelled', controller.signal).catch(() => 'aborted');
  await settle();
  const kept = call(url, 2, 'kept');
  await settle();
  controller.abort();
  await settle();
  assert.equal(await cancelled, 'aborted');
  mock.timers.tick(WINDOW_MS);
  assert.deepEqual(requests(events).map(event => event.input.command), ['kept']);
  mock.timers.reset();
  session.close();
  await kept;
});

test('each answer goes back to its own request', async t => {
  const { events, session, url } = await startSession(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const second = call(url, 2, 'second');
  await settle();
  const first = call(url, 1, 'first');
  await settle();
  mock.timers.tick(WINDOW_MS);
  const [a, b] = requests(events);
  assert.notEqual(a.id, b.id);
  // Answer out of order: the second request is allowed first, then the first is denied.
  session.answerPermission(b.id, { allow: true });
  session.answerPermission(a.id, { allow: false, message: 'no thanks' });
  assert.deepEqual(await second, { behavior: 'allow', updatedInput: { command: 'second' } });
  assert.deepEqual(await first, { behavior: 'deny', message: 'no thanks' });
  mock.timers.reset();
});
