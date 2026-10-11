import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceTargets, fencedCode } from '../../src/renderer/markdown.ts';

test('referenceTargets finds link definitions by normalized label', () => {
  const targets = referenceTargets('[Doc  Page][x]\n\n[doc page]: https://example.invalid/?a=1&amp;b=2 "Title"\n[Other]: <https://example.invalid/o>\n');
  assert.equal(targets.get('doc page'), 'https://example.invalid/?a=1&b=2');
  assert.ok(targets.has('other'));
});

test('fencedCode reads all lines of fences inside lists and quotes', () => {
  assert.deepEqual(fencedCode('- item\n  ```ts\n  const x = 1;\n  const y = 2;\n  ```\n'), [{ language: 'ts', code: 'const x = 1;\nconst y = 2;\n' }]);
  assert.deepEqual(fencedCode('> ```\n> a\n> b\n> ```\n'), [{ language: '', code: 'a\nb\n' }]);
});
