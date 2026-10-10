import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createParser } = require('../../src/agents/claude-events.cjs');
const { childEnv, createClaudeProvider } =require('../../src/agents/claude.cjs');
const { Chats } = require('../../src/agents/chats.cjs');
const { createChat, reduce, toolTarget, splitBlocks } = require('../../src/renderer/chat-model.js');

const line = value => `${JSON.stringify(value)}\n`;
const delta = text => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

test('parser maps init, streamed text, tool use, tool result and result', () => {
  const parser = createParser();
  const events = [
    ...parser.push(line({ type: 'system', subtype: 'init', session_id: 's1' })),
    ...parser.push(line({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } })),
    ...parser.push(line(delta('Hi'))),
    ...parser.push(line({ type: 'stream_event', event: { type: 'message_stop' } })),
    ...parser.push(line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } }] } })),
    ...parser.push(line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'body' }], is_error: false }] } })),
    ...parser.push(line({ type: 'result', is_error: false, result: 'Hi' })),
  ];
  assert.deepEqual(events, [
    { type: 'session', id: 's1' },
    { type: 'text', text: 'Hi' },
    { type: 'message-end' },
    { type: 'tool-use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } },
    { type: 'tool-result', id: 't1', output: 'body', isError: false },
    { type: 'turn-end' },
  ]);
});

test('parser shows a reply that was not streamed, and joins split chunks', () => {
  const parser = createParser();
  const text = line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Whole' }] } });
  assert.deepEqual(parser.push(text.slice(0, 20)), []);
  assert.deepEqual(parser.push(text.slice(20)), [{ type: 'text-block', text: 'Whole' }]);
  assert.deepEqual(parser.push('not json\n'), []);
});

test('parser ignores sub-agent traffic and classifies a login failure', () => {
  const parser = createParser();
  assert.deepEqual(parser.push(line({ ...delta('x'), parent_tool_use_id: 'task1' })), []);
  const [failed] = parser.push(line({ type: 'result', is_error: true, result: 'Not logged in. Please run claude auth login.' }));
  assert.equal(failed.kind, 'not-logged-in');
  const [other] = parser.push(line({ type: 'result', is_error: true, result: 'Rate limited' }));
  assert.equal(other.kind, 'failed');
});

test('child environment drops credentials and bare mode', () => {
  const env = childEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'y', ANTHROPIC_AUTH_TOKEN: 'z', CLAUDE_CODE_SIMPLE: '1', COD_FAKE_CLAUDE_LOG: 'l', ANTHROPIC_BASE_URL: 'u' });
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_BASE_URL', 'COD_FAKE_CLAUDE_LOG', 'PATH']);
});

test('transcript: streaming reply, tool call and result', () => {
  let state = createChat();
  for (const event of [
    { type: 'user-message', text: 'go' },
    { type: 'session', id: 's1' },
    { type: 'text', text: 'One' },
    { type: 'text', text: ' two' },
  ]) state = reduce(state, event);
  assert.equal(state.busy, true);
  assert.equal(state.sessionId, 's1');
  assert.deepEqual(state.items.map(i => [i.kind, i.text, i.state]), [['user', 'go', undefined], ['assistant', 'One two', 'streaming']]);
  state = reduce(state, { type: 'tool-use', id: 't', name: 'Bash', input: { command: 'ls' } });
  assert.equal(state.items[1].state, 'complete');
  state = reduce(state, { type: 'tool-result', id: 't', output: 'a', isError: false });
  assert.equal(state.items[2].output, 'a');
  state = reduce(state, { type: 'turn-end' });
  assert.equal(state.busy, false);
});

test('transcript: interrupt marks the reply and ends the turn; login errors give the help text', () => {
  let state = createChat();
  for (const event of [{ type: 'user-message', text: 'go' }, { type: 'text', text: 'Part' }, { type: 'interrupted' }]) state = reduce(state, event);
  assert.equal(state.items[1].state, 'interrupted');
  assert.equal(state.items[2].kind, 'interrupted');
  assert.equal(state.busy, false);
  state = reduce(state, { type: 'text', text: 'Next' });
  assert.equal(state.items[3].state, 'streaming');
  state = reduce(state, { type: 'error', kind: 'not-logged-in', message: 'raw' });
  assert.match(state.items[4].message, /claude auth login/);
});

test('toolTarget picks the file, command or first string', () => {
  assert.equal(toolTarget({ file_path: '/a/b.txt', x: 1 }), '/a/b.txt');
  assert.equal(toolTarget({ command: 'ls\nmore' }), 'ls');
  assert.equal(toolTarget({ other: 'value' }), 'value');
  assert.equal(toolTarget({ n: 1 }), '');
});

test('splitBlocks finds fenced code and tolerates an unclosed fence', () => {
  assert.deepEqual(splitBlocks('a\n```js\nx\n```\nb'), [{ type: 'text', text: 'a\n' }, { type: 'code', text: 'x' }, { type: 'text', text: '\nb' }]);
  assert.deepEqual(splitBlocks('a\n```\nstill'), [{ type: 'text', text: 'a\n' }, { type: 'code', text: 'still' }]);
  assert.deepEqual(splitBlocks('plain'), [{ type: 'text', text: 'plain' }]);
});

function fakeProvider() {
  const started = [];
  return {
    started,
    start(options) {
      const session = {
        options, alive: true, interrupting: false, sent: [],
        send(text) { this.sent.push(text); },
        interrupt() { this.interrupting = true; },
        close() { this.alive = false; },
      };
      started.push(session);
      return session;
    },
  };
}

test('Chats: cwd is the first folder or home, and a new process after an interrupt resumes the session', () => {
  const provider = fakeProvider();
  const roots = { w1: ['/proj/a', '/proj/b'] };
  const emitted = [];
  const chats = new Chats({ provider, folders: { list: id => roots[id] || [] }, emit: (id, event) => emitted.push([id, event]), home: '/home/me' });
  assert.deepEqual(chats.info('w1'), { cwd: '/proj/a', home: false });
  assert.deepEqual(chats.info('w2'), { cwd: '/home/me', home: true });
  chats.send('w1', 'hello');
  const first = provider.started[0];
  assert.equal(first.options.cwd, '/proj/a');
  assert.equal(first.options.resume, undefined);
  first.options.onEvent({ type: 'session', id: 'abc' });
  chats.send('w1', 'again');
  assert.equal(provider.started.length, 1);
  assert.deepEqual(first.sent, ['hello', 'again']);
  chats.interrupt('w1');
  chats.send('w1', 'after');
  assert.equal(provider.started.length, 2);
  assert.equal(provider.started[1].options.resume, 'abc');
  // The old process still reports its interruption; its other output is dropped.
  first.options.onEvent({ type: 'text', text: 'late' });
  first.options.onEvent({ type: 'interrupted' });
  assert.deepEqual(emitted.map(([, e]) => e.type), ['session', 'interrupted']);
});

test('Chats: a changed first folder moves an idle process at once and a busy one after its turn, keeping the session', () => {
  const provider = fakeProvider();
  const roots = { w1: [] };
  const chats = new Chats({ provider, folders: { list: id => roots[id] || [] }, emit: () => {}, home: '/home/me' });
  chats.send('w1', 'one');
  const first = provider.started[0];
  assert.equal(first.options.cwd, '/home/me');
  first.options.onEvent({ type: 'session', id: 'abc' });
  // Mid-turn: the folder changes, but the real directory stays until the turn ends.
  roots.w1 = ['/proj/a'];
  chats.foldersChanged('w1');
  assert.equal(first.alive, true);
  assert.deepEqual(chats.info('w1'), { cwd: '/home/me', home: true });
  first.options.onEvent({ type: 'turn-end' });
  assert.equal(first.alive, false);
  assert.deepEqual(chats.info('w1'), { cwd: '/proj/a', home: false });
  chats.send('w1', 'two');
  const second = provider.started[1];
  assert.equal(second.options.cwd, '/proj/a');
  assert.equal(second.options.resume, 'abc');
  second.options.onEvent({ type: 'turn-end' });
  // Idle: the change applies immediately.
  roots.w1 = ['/proj/b'];
  chats.foldersChanged('w1');
  assert.equal(second.alive, false);
  chats.send('w1', 'three');
  assert.equal(provider.started[2].options.cwd, '/proj/b');
  assert.equal(provider.started[2].options.resume, 'abc');
});

const stubborn = fileURLToPath(new URL('./helpers/stubborn-claude.cjs', import.meta.url));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function stubbornSession(onEvent) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-unit-stubborn-'));
  const pidFile = path.join(dir, 'pids');
  const provider = createClaudeProvider({ bin: stubborn, env: { ...process.env, STUBBORN_PID_FILE: pidFile }, graceMs: 100 });
  const session = provider.start({ cwd: dir, onEvent, onExit: () => {} });
  session.send('hi');
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise(resolve => setTimeout(resolve, 50));
  await new Promise(resolve => setTimeout(resolve, 100));
  const [cli, tool] = readFileSync(pidFile, 'utf8').split(' ').map(Number);
  return { session, cli, tool, dir };
}

test('interrupt on a process that ignores signals still ends it, its tools, and reports interrupted', async () => {
  const events = [];
  const { session, cli, tool, dir } = await stubbornSession(event => events.push(event.type));
  try {
    session.interrupt();
    await session.exited;
    assert.equal(alive(cli), false);
    assert.equal(alive(tool), false);
    assert.deepEqual(events, ['interrupted']);
    assert.equal(session.alive, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('close on a process that ignores signals still ends it and its tools', async () => {
  const events = [];
  const { session, cli, tool, dir } = await stubbornSession(event => events.push(event.type));
  try {
    await session.close();
    assert.equal(alive(cli), false);
    assert.equal(alive(tool), false);
    assert.deepEqual(events, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
