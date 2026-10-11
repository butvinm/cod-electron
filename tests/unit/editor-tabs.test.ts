import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabs, open, activate, close, displayPath, moveChoice, errorMessage, attemptSave, confirmOrKeep, createLocks, editFilter } from '../../src/renderer/editor-tabs.ts';

const opened = (...files: string[]) => files.reduce(open, createTabs());

test('opening a new file adds a tab and activates it', () => {
  const t = opened('/a', '/b');
  assert.deepEqual(t.paths, ['/a', '/b']);
  assert.equal(t.active, '/b');
});

test('opening an open file activates it without a duplicate', () => {
  const t = open(opened('/a', '/b'), '/a');
  assert.deepEqual(t.paths, ['/a', '/b']);
  assert.equal(t.active, '/a');
});

test('a new tab goes right after the active tab', () => {
  const t = open(activate(opened('/a', '/b'), '/a'), '/c');
  assert.deepEqual(t.paths, ['/a', '/c', '/b']);
});

test('closing the active tab activates the previously active one, not the neighbour', () => {
  let t = opened('/a', '/b', '/c');
  t = activate(t, '/a');
  t = activate(t, '/c');
  t = close(t, '/c');
  assert.equal(t.active, '/a');
  assert.deepEqual(t.paths, ['/a', '/b']);
});

test('closing an inactive tab keeps the active one', () => {
  const t = close(opened('/a', '/b'), '/a');
  assert.equal(t.active, '/b');
});

test('closing the last tab leaves nothing active', () => {
  const t = close(opened('/a'), '/a');
  assert.equal(t.active, null);
  assert.deepEqual(t.paths, []);
});

test('activate and close ignore unknown files', () => {
  const t = opened('/a');
  assert.equal(activate(t, '/x'), t);
  assert.equal(close(t, '/x'), t);
});

test('displayPath is relative to the root, with the root name when there are several', () => {
  assert.equal(displayPath(['/p/orchard'], '/p/orchard/src/a.ts'), 'src/a.ts');
  assert.equal(displayPath(['/p/orchard', '/p/harbor'], '/p/harbor/a.ts'), 'harbor/a.ts');
  assert.equal(displayPath(['/p/orch'], '/p/orchard/a.ts'), '/p/orchard/a.ts');
});

test('errorMessage strips the IPC wrapper', () => {
  assert.equal(errorMessage(new Error("Error invoking remote method 'editor:write': Error: No space left")), 'No space left');
  assert.equal(errorMessage('plain'), 'plain');
});

// Both entry points (Cmd+S and the close prompt's Save) go through attemptSave.
for (const entry of ['Cmd+S', 'close prompt Save']) {
  test(`a failed save from ${entry} shows a message, restores focus and reports failure`, async () => {
    const events: unknown[] = [];
    const ok = await attemptSave({
      name: 'a.txt',
      write: async () => { throw new Error("Error invoking remote method 'editor:write': Error: disk full"); },
      report: message => events.push(['report', message]),
      restoreFocus: () => events.push(['focus']),
    });
    assert.equal(ok, false);
    assert.deepEqual(events, [['report', 'Could not save a.txt: disk full'], ['focus']]);
  });
}

test('a successful save clears the message', async () => {
  const events: unknown[] = [];
  const ok = await attemptSave({ name: 'a.txt', write: async () => {}, report: m => events.push(m), restoreFocus: () => events.push('focus') });
  assert.equal(ok, true);
  assert.deepEqual(events, [null]);
});

test('moveChoice wraps both ways', () => {
  assert.equal(moveChoice(0, -1, 3), 2);
  assert.equal(moveChoice(2, 1, 3), 0);
  assert.equal(moveChoice(0, 1, 3), 1);
});

test('a confirmation that fails keeps the app open and reports the reason', async () => {
  const messages: string[] = [];
  assert.equal(await confirmOrKeep(async () => { throw new Error('boom'); }, m => messages.push(m)), false);
  assert.deepEqual(messages, ['Could not check for unsaved files: boom']);
});

test('a locked workspace drops edits, including to a tab that was clean, and unlocking allows them again', () => {
  const locks = createLocks();
  const filter = editFilter(() => locks.has('ws-1'));
  const edit = { docChanged: true };
  const move = { docChanged: false };
  assert.equal(filter(edit), edit);
  locks.lock(['ws-1', 'ws-2']);
  assert.deepEqual(filter(edit), []);
  assert.equal(filter(move), move);
  locks.unlock(['ws-1']);
  assert.equal(filter(edit), edit);
  assert.equal(locks.has('ws-2'), true);
});

test('lockAll also covers workspaces that appear later', () => {
  const locks = createLocks();
  locks.lockAll();
  assert.equal(locks.has('ws-new'), true);
  locks.unlock(['ws-new']);
  assert.equal(locks.has('ws-new'), true);
});

test('only an explicit yes lets the confirmation go on', async () => {
  const report = () => assert.fail('no report expected');
  assert.equal(await confirmOrKeep(async () => true, report), true);
  assert.equal(await confirmOrKeep(async () => false, report), false);
  assert.equal(await confirmOrKeep(async () => undefined, report), false);
});
