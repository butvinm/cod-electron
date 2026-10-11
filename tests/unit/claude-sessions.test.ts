import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeFolder, storeRoot, eventsOf, listSessions, openSession } from '../../src/agents/claude-sessions.ts';

const ID1 = '550e8400-e29b-41d4-a716-446655440001';
const ID2 = '550e8400-e29b-41d4-a716-446655440002';

function line(type: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, message: { role: type, content }, timestamp: '2026-01-02T03:04:05.000Z', ...extra });
}

function store(): { root: string; folder: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-sessions-'));
  const folder = path.join(root, 'my.project_x');
  fs.mkdirSync(folder);
  return { root: path.join(root, 'projects'), folder: fs.realpathSync(folder) };
}

function write(root: string, folder: string, id: string, lines: string[]): void {
  const dir = path.join(root, encodeFolder(folder));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
}

test('encodeFolder replaces every character outside a-z, A-Z and 0-9', () => {
  assert.equal(encodeFolder('/Users/a b/my.proj_1'), '-Users-a-b-my-proj-1');
});

test('storeRoot uses CLAUDE_CONFIG_DIR, else ~/.claude', () => {
  assert.equal(storeRoot({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u'), path.join('/cfg', 'projects'));
  assert.equal(storeRoot({}, '/home/u'), path.join('/home/u', '.claude', 'projects'));
  assert.equal(storeRoot({ CLAUDE_CONFIG_DIR: 'relative' }, '/home/u'), path.join('/home/u', '.claude', 'projects'));
});

test('eventsOf replays user text, replies and tool calls, and skips notes and sub-agents', () => {
  const events = eventsOf([
    JSON.stringify({ type: 'mode', mode: 'default' }),
    line('user', '<command-name>/clear</command-name>'),
    line('user', 'Question one'),
    line('assistant', [{ type: 'thinking', thinking: 'hmm' }]),
    line('assistant', [{ type: 'text', text: 'Answer one' }]),
    line('assistant', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } }]),
    line('user', [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }], is_error: false }]),
    line('assistant', [{ type: 'text', text: 'hidden' }], { isSidechain: true }),
    line('user', [{ type: 'text', text: 'Part A' }, { type: 'text', text: 'Part B' }]),
    'not json',
  ]);
  assert.deepEqual(events, [
    { type: 'user-message', text: 'Question one' },
    { type: 'text-block', text: 'Answer one' },
    { type: 'tool-use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } },
    { type: 'tool-result', id: 't1', output: 'file body', isError: false },
    { type: 'user-message', text: 'Part A\nPart B' },
    { type: 'turn-end' },
  ]);
});

test('listSessions gives the first user message and last turn time, newest first', () => {
  const { root, folder } = store();
  write(root, folder, ID1, [line('user', 'Older  first\nmessage', { timestamp: '2026-01-01T00:00:00.000Z' }), line('assistant', [{ type: 'text', text: 'x' }], { timestamp: '2026-01-01T00:05:00.000Z' })]);
  write(root, folder, ID2, [JSON.stringify({ type: 'mode' }), line('user', 'Newer', { timestamp: '2026-01-03T00:00:00.000Z' })]);
  write(root, folder, '550e8400-e29b-41d4-a716-446655440003', [line('user', '<local-command-stdout>x</local-command-stdout>')]);
  const sessions = listSessions([folder, folder], root);
  assert.deepEqual(sessions.map(s => [s.id, s.title, s.updated]), [
    [ID2, 'Newer', Date.parse('2026-01-03T00:00:00.000Z')],
    [ID1, 'Older first message', Date.parse('2026-01-01T00:05:00.000Z')],
  ]);
  assert.equal(sessions[0].folder, folder);
  assert.deepEqual(listSessions(['/nowhere'], root), []);
});

test('openSession finds a session only in the given folders and refuses odd ids', () => {
  const { root, folder } = store();
  write(root, folder, ID1, [line('user', 'Hello')]);
  assert.equal(openSession([folder], ID1, root)?.folder, folder);
  assert.equal(openSession(['/nowhere'], ID1, root), null);
  assert.equal(openSession([folder], '../../etc/passwd', root), null);
});
