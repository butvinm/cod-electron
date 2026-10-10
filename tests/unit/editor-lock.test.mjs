import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { lockExtension, withLocked } from '../../src/renderer/editor-lock.mjs';

const make = text => EditorState.create({ doc: text, extensions: [history(), lockExtension(false)] });
const run = (command, state) => {
  let next = state;
  const handled = command({ state, dispatch: transaction => { next = transaction.state; } });
  return { handled, next };
};
const typed = state => state.update({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }).state;

// A listed tab has unsaved edits; a previously clean tab has none yet.
for (const [name, start] of [['a tab with unsaved edits', typed(make('abc'))], ['a previously clean tab', make('abc')]]) {
  test(`Undo and Redo are refused while ${name} is locked`, () => {
    const edited = start.doc.toString() === 'abc' ? typed(start) : start;
    const undone = run(undo, edited).next;
    assert.equal(undone.doc.toString(), 'abc');
    const locked = withLocked(edited, true);
    assert.equal(locked.readOnly, true);
    assert.equal(run(undo, locked).handled, false);
    assert.equal(run(undo, locked).next.doc.toString(), edited.doc.toString());
    const lockedUndone = withLocked(undone, true);
    assert.equal(run(redo, lockedUndone).handled, false);
    assert.equal(run(redo, lockedUndone).next.doc.toString(), 'abc');
  });
}

test('unlocking makes Undo work again', () => {
  const edited = typed(make('abc'));
  const again = withLocked(withLocked(edited, true), false);
  assert.equal(again.readOnly, false);
  assert.equal(run(undo, again).next.doc.toString(), 'abc');
});
