import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceTargets, fencedCode } from '../../src/renderer/markdown.ts';

test('referenceTargets finds link definitions by normalized label', () => {
  const targets = referenceTargets('[Doc  Page][x]\n\n[doc page]: https://example.invalid/?a=1&#38;b=2 "Title"\n[Other]: <https://example.invalid/o>\n');
  assert.equal(targets.get('doc page'), 'https://example.invalid/?a=1&b=2');
  assert.ok(targets.has('other'));
});

test('referenceTargets finds definitions inside quotes and list items', () => {
  assert.equal(referenceTargets('> [reference][doc]\n>\n> [doc]: https://example.invalid/q\n').get('doc'), 'https://example.invalid/q');
  assert.equal(referenceTargets('- item\n\n  [doc]: https://example.invalid/l\n').get('doc'), 'https://example.invalid/l');
});

test('fencedCode keeps blank lines at the end of a fence', () => {
  assert.deepEqual(fencedCode('```\na\n\n```\n'), [{ language: '', code: 'a\n\n' }]);
  assert.deepEqual(fencedCode('```\n\n```\n'), [{ language: '', code: '\n\n' }]);
  assert.deepEqual(fencedCode('- i\n  ```\n  a\n\n  ```\n'), [{ language: '', code: 'a\n\n' }]);
});

test('fencedCode reads all lines of fences inside lists and quotes', () => {
  assert.deepEqual(fencedCode('- item\n  ```ts\n  const x = 1;\n  const y = 2;\n  ```\n'), [{ language: 'ts', code: 'const x = 1;\nconst y = 2;\n' }]);
  assert.deepEqual(fencedCode('> ```\n> a\n> b\n> ```\n'), [{ language: '', code: 'a\nb\n' }]);
});
