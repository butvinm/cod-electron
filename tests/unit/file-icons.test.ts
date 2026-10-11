import test from 'node:test';
import assert from 'node:assert/strict';
import { iconNameFor } from '../../src/renderer/file-icon-names.ts';
import { ancestorsOf } from '../../src/renderer/project-tree.ts';

test('iconNameFor follows the Zed file type table and falls back to the default file icon', () => {
  const names = ['a.ts', 'a.json', 'a.md', 'a.rs', 'a.py', 'a.unknown-cod37', 'Makefile', 'a.TS'].map(n => iconNameFor(n, false, false));
  assert.deepEqual(names, ['typescript', 'code', 'book', 'rust', 'python', 'file', 'file', 'typescript']);
});

test('iconNameFor picks the closed or open folder icon', () => {
  assert.equal(iconNameFor('src', true, false), 'folder');
  assert.equal(iconNameFor('src', true, true), 'folder_open');
});

test('ancestorsOf lists the root and every folder down to the file', () => {
  assert.deepEqual(ancestorsOf(['/p/app'], '/p/app/a/b/f.ts'), ['/p/app', '/p/app/a', '/p/app/a/b']);
  assert.deepEqual(ancestorsOf(['/p/app'], '/p/app/f.ts'), ['/p/app']);
  assert.deepEqual(ancestorsOf(['/p/app'], '/p/apple/f.ts'), []);
  assert.deepEqual(ancestorsOf(['C:\\p'], 'C:\\p\\a\\f.ts'), ['C:\\p', 'C:\\p\\a']);
});
