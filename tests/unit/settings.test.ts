import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDefaultChatFolder, settingsPath, stripJsonComments } from '../../src/settings.ts';
import { Chats } from '../../src/agents/chats.ts';
import type { AgentProvider, AgentSession, StartOptions } from '../../src/agents/provider.ts';

function withDir(body: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-settings-'));
  try { body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('comments and trailing commas are removed, strings stay', () => {
  const text = '// c\n{ /* b */ "a": "x // y /* z */", "b": [1, 2,], }';
  assert.deepEqual(JSON.parse(stripJsonComments(text)), { a: 'x // y /* z */', b: [1, 2] });
});

test('settings path follows XDG_CONFIG_HOME, else ~/.config', () => {
  assert.equal(settingsPath({ XDG_CONFIG_HOME: '/x' }, '/h'), path.join('/x', 'cod', 'settings.json'));
  assert.equal(settingsPath({}, '/h'), path.join('/h', '.config', 'cod', 'settings.json'));
});

test('default_chat_folder: valid, absent, invalid JSON, missing folder', () => {
  withDir(dir => {
    const file = path.join(dir, 'settings.json');
    const folder = path.join(dir, 'chat');
    mkdirSync(folder);
    assert.deepEqual(readDefaultChatFolder(file), { folder: null, notice: null });
    writeFileSync(file, `// note\n{ "default_chat_folder": ${JSON.stringify(folder)} }`);
    assert.deepEqual(readDefaultChatFolder(file), { folder, notice: null });
    writeFileSync(file, '{ "other": 1 }');
    assert.deepEqual(readDefaultChatFolder(file), { folder: null, notice: null });
    writeFileSync(file, '{ "default_chat_folder": ');
    const bad = readDefaultChatFolder(file);
    assert.equal(bad.folder, null);
    assert.match(bad.notice ?? '', /Invalid JSON in settings\.json/);
    const missing = path.join(dir, 'nope');
    writeFileSync(file, JSON.stringify({ default_chat_folder: missing }));
    const gone = readDefaultChatFolder(file);
    assert.equal(gone.folder, null);
    assert.ok(gone.notice?.includes(missing) && /does not exist/.test(gone.notice));
  });
});

function fakeProvider(starts: StartOptions[]): AgentProvider {
  return {
    start(options: StartOptions): AgentSession {
      starts.push(options);
      const session = { alive: true, interrupting: false, send() {}, interrupt() {}, answerPermission() {}, close() { session.alive = false; } };
      return session as unknown as AgentSession;
    },
  } as unknown as AgentProvider;
}

test('chats: first folder wins, then default folder, then home; reset starts without resume', () => {
  const starts: StartOptions[] = [];
  let roots: string[] = ['/first'];
  const chats = new Chats({ provider: fakeProvider(starts), folders: { list: () => roots }, emit: () => {}, home: '/home', defaultFolder: () => ({ folder: '/def', notice: null }) });
  assert.equal(chats.info('w').cwd, '/first');
  roots = [];
  assert.equal(chats.info('w').cwd, '/def');
  chats.send('w', 'hi');
  assert.equal(starts[0].cwd, '/def');
  chats.reset('w');
  chats.send('w', 'again');
  assert.equal(starts[1].resume, undefined);
  const noDefault = new Chats({ provider: fakeProvider(starts), folders: { list: () => [] }, emit: () => {}, home: '/home', defaultFolder: () => ({ folder: null, notice: 'problem' }) });
  assert.deepEqual(noDefault.info('w'), { cwd: '/home', home: true, notice: 'problem' });
});
