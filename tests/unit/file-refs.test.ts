import test from 'node:test';
import assert from 'node:assert/strict';
import { findFileRefs, wholeFileRef } from '../../src/renderer/file-refs.ts';

test('findFileRefs finds a path with and without line and column', () => {
  const text = 'See src/a.ts, src/a.ts:12 and src/a.ts:12:5.';
  assert.deepEqual(findFileRefs(text).map(found => found.ref), [
    { path: 'src/a.ts' },
    { path: 'src/a.ts', line: 12 },
    { path: 'src/a.ts', line: 12, column: 5 },
  ]);
  const last = findFileRefs(text)[2];
  assert.equal(text.slice(last.from, last.to), 'src/a.ts:12:5');
});

test('findFileRefs reads absolute and parent paths and drops a final full stop', () => {
  const refs = findFileRefs('Edited /tmp/x/y.ts:9:5 and ../out.ts. Done.');
  assert.deepEqual(refs.map(found => found.ref.path), ['/tmp/x/y.ts', '../out.ts']);
});

test('findFileRefs skips words, urls and the middle of other paths', () => {
  assert.deepEqual(findFileRefs('plain words, no files here.'), []);
  assert.deepEqual(findFileRefs('open https://example.invalid/a/b.html now'), []);
  assert.deepEqual(findFileRefs('see foo:src/a.ts'), []);
});

test('wholeFileRef accepts only a text that is one path', () => {
  assert.deepEqual(wholeFileRef('src/a.ts:12'), { path: 'src/a.ts', line: 12 });
  assert.equal(wholeFileRef('run src/a.ts'), null);
  assert.equal(wholeFileRef('npm test'), null);
});
