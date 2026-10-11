import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextPermissionMode, permissionModeLabel, isPermissionMode, type ChatEvent, type PermissionMode } from '../../src/shared/chat.ts';
import { readDefaultMode, modeFromName } from '../../src/agents/claude-settings.ts';
import { createParser } from '../../src/agents/claude-events.ts';
import { Chats } from '../../src/agents/chats.ts';
import type { AgentProvider, AgentSession, StartOptions } from '../../src/agents/provider.ts';
import { createChat, reduce } from '../../src/renderer/chat-model.ts';

test('Shift+Tab order is Manual, Accept Edits, Plan, Auto, then around', () => {
  const seen: string[] = [];
  let mode: PermissionMode = 'manual';
  for (let count = 0; count < 5; count++) { seen.push(permissionModeLabel(mode)); mode = nextPermissionMode(mode); }
  assert.deepEqual(seen, ['Manual', 'Accept Edits', 'Plan', 'Auto', 'Manual']);
  assert.equal(isPermissionMode('dontAsk'), false);
});

test('the default mode comes from permissions.defaultMode in the Claude config folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-settings-'));
  try {
    const env = { CLAUDE_CONFIG_DIR: dir };
    assert.equal(readDefaultMode(env, '/nowhere'), 'manual', 'no file');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    assert.equal(readDefaultMode(env, '/nowhere'), 'auto');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
    assert.equal(readDefaultMode(env, '/nowhere'), 'manual', 'a mode Cod does not offer');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
    assert.equal(readDefaultMode(env, '/nowhere'), 'manual', 'broken file');
    fs.writeFileSync(path.join(dir, 'settings.json'), 'null');
    assert.equal(readDefaultMode(env, '/nowhere'), 'manual');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(modeFromName('default'), 'manual');
  assert.equal(modeFromName('acceptEdits'), 'acceptEdits');
});

test('a status line with a permission mode becomes a mode event; init does not', () => {
  const parser = createParser();
  const events = parser.push([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', permissionMode: 'plan' }),
    JSON.stringify({ type: 'system', subtype: 'status', status: null, permissionMode: 'default' }),
    JSON.stringify({ type: 'system', subtype: 'status', status: 'compacting' }),
    JSON.stringify({ type: 'system', subtype: 'status', permissionMode: 'dontAsk' }),
    '',
  ].join('\n'));
  assert.deepEqual(events, [{ type: 'session', id: 's' }, { type: 'mode', mode: 'manual' }]);
});

test('the transcript state follows mode events', () => {
  const state = reduce(createChat(), { type: 'mode', mode: 'plan' });
  assert.equal(state.mode, 'plan');
  assert.equal(reduce(state, { type: 'mode', mode: 'plan' }), state);
});

function recordingProvider() {
  const started: { options: StartOptions; modes: PermissionMode[] }[] = [];
  const provider: AgentProvider = {
    start(options) {
      const entry = { options, modes: [] as PermissionMode[] };
      started.push(entry);
      const session: AgentSession = {
        alive: true, interrupting: false,
        send() {}, interrupt() {}, answerPermission() {}, close() {},
        setPermissionMode: mode => { entry.modes.push(mode); },
      };
      return session;
    },
  };
  return { provider, started };
}

test('chats start a process in the chosen mode and tell a running one', () => {
  const { provider, started } = recordingProvider();
  const emitted: ChatEvent[] = [];
  const chats = new Chats({ provider, folders: { list: () => [] }, emit: (_id, event) => emitted.push(event), home: '/h', defaultMode: () => 'auto' });
  assert.equal(chats.mode('w'), 'auto');
  chats.setMode('w', 'plan');
  assert.equal(started.length, 0, 'no process yet');
  chats.send('w', 'go');
  assert.equal(started[0].options.permissionMode, 'plan');
  assert.deepEqual(started[0].modes, []);
  chats.setMode('w', 'manual');
  chats.setMode('w', 'manual');
  assert.deepEqual(started[0].modes, ['manual'], 'sent once, to the running process');
  started[0].options.onEvent({ type: 'mode', mode: 'auto' });
  assert.equal(chats.mode('w'), 'auto', 'a reported mode is kept');
  assert.deepEqual(started[0].modes, ['manual'], 'and not sent back');
  assert.deepEqual(emitted, [{ type: 'mode', mode: 'auto' }]);
});
