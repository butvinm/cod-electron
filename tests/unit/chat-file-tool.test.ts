import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { filePathOf } from '../../src/renderer/chat-model.ts';
import { caretOffset } from '../../src/renderer/editor-cm.ts';

test('filePathOf gives the file_path of file tools only', () => {
  assert.equal(filePathOf({ name: 'Read', input: { file_path: 'src/a.ts' } }), 'src/a.ts');
  assert.equal(filePathOf({ name: 'MultiEdit', input: { file_path: '/x/y.ts', edits: [] } }), '/x/y.ts');
  assert.equal(filePathOf({ name: 'Bash', input: { file_path: 'src/a.ts' } }), null);
  assert.equal(filePathOf({ name: 'Read', input: { file_path: '' } }), null);
  assert.equal(filePathOf({ name: 'Read', input: null }), null);
});

test('caretOffset is one-based and clamps to the text', () => {
  const state = EditorState.create({ doc: 'abc\nde\nf' });
  assert.equal(caretOffset(state, 1, 1), 0);
  assert.equal(caretOffset(state, 2, 2), 5);
  assert.equal(caretOffset(state, 2, 99), 6);
  assert.equal(caretOffset(state, 99, 1), 7);
  assert.equal(caretOffset(state, 0, 0), 0);
});
