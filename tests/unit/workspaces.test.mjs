import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createState, add, activate, step, close } = createRequire(import.meta.url)('../../src/renderer/workspaces.js');

const names = s => s.workspaces.map(w => w.name);
const activeName = s => s.workspaces.find(w => w.id === s.activeId).name;

test('starts with one active workspace', () => {
  const s = createState();
  assert.deepEqual(names(s), ['Workspace 1']);
  assert.equal(activeName(s), 'Workspace 1');
});

test('add appends and activates', () => {
  const s = add(add(createState()));
  assert.deepEqual(names(s), ['Workspace 1', 'Workspace 2', 'Workspace 3']);
  assert.equal(activeName(s), 'Workspace 3');
});

test('step wraps in both directions', () => {
  let s = add(createState());
  s = step(s, 1);
  assert.equal(activeName(s), 'Workspace 1');
  s = step(s, -1);
  assert.equal(activeName(s), 'Workspace 2');
});

test('closing the active middle tab selects its neighbour', () => {
  let s = add(add(createState()));
  s = activate(s, s.workspaces[1].id);
  s = close(s, s.activeId);
  assert.deepEqual(names(s), ['Workspace 1', 'Workspace 3']);
  assert.equal(activeName(s), 'Workspace 3');
});

test('closing the last tab at the end selects the left neighbour', () => {
  let s = add(createState());
  s = close(s, s.activeId);
  assert.equal(activeName(s), 'Workspace 1');
});

test('closing an inactive tab keeps the active one', () => {
  let s = add(createState());
  s = close(s, s.workspaces[0].id);
  assert.equal(activeName(s), 'Workspace 2');
});

test('closing the last workspace creates a fresh one with a new id', () => {
  const s = createState();
  const oldId = s.activeId;
  const next = close(s, oldId);
  assert.equal(next.workspaces.length, 1);
  assert.notEqual(next.activeId, oldId);
});
