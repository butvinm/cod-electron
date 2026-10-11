import test from 'node:test';
import assert from 'node:assert/strict';
import { iconNameFor } from '../../src/renderer/file-icon-names.ts';
import { ancestorsOf, revealStep } from '../../src/renderer/project-tree.ts';

test('iconNameFor follows the Zed file kinds and falls back to the default file icon', () => {
  const names = ['a.ts', 'a.json', 'a.md', 'a.rs', 'a.py', 'a.unknown-cod37', 'Makefile', 'a.TS'].map(n => iconNameFor(n, false, false));
  assert.deepEqual(names, ['file-code', 'file-braces', 'book-open', 'file-code', 'file-code', 'file', 'file', 'file-code']);
});

test('iconNameFor picks the closed or open folder icon', () => {
  assert.equal(iconNameFor('src', true, false), 'folder');
  assert.equal(iconNameFor('src', true, true), 'folder-open');
});

test('ancestorsOf lists the root and every folder down to the file', () => {
  assert.deepEqual(ancestorsOf(['/p/app'], '/p/app/a/b/f.ts'), ['/p/app', '/p/app/a', '/p/app/a/b']);
  assert.deepEqual(ancestorsOf(['/p/app'], '/p/app/f.ts'), ['/p/app']);
  assert.deepEqual(ancestorsOf(['/p/app'], '/p/apple/f.ts'), []);
  assert.deepEqual(ancestorsOf(['C:\\p'], 'C:\\p\\a\\f.ts'), ['C:\\p', 'C:\\p\\a']);
});

test('revealStep redraws when the active file changes, including when the last tab closes', () => {
  assert.deepEqual(revealStep(undefined, '/p/a.ts'), { render: false, reveal: '/p/a.ts' });
  assert.deepEqual(revealStep('/p/a.ts', '/p/a.ts'), { render: false, reveal: null });
  assert.deepEqual(revealStep('/p/a.ts', null), { render: true, reveal: null });
  assert.deepEqual(revealStep(null, null), { render: false, reveal: null });
});
