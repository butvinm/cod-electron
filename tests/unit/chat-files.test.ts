import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMention, firstChangedLine, replacementsOf } from '../../src/chat-files.ts';

function layout() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cod-chat-files-')));
  const one = path.join(dir, 'one');
  const two = path.join(dir, 'two');
  for (const root of [one, two]) fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(one, 'src/shared.ts'), 'one');
  fs.writeFileSync(path.join(two, 'src/shared.ts'), 'two');
  fs.writeFileSync(path.join(two, 'src/only.ts'), 'two');
  fs.writeFileSync(path.join(dir, 'outside.ts'), 'out');
  const inside = (file: string) => file.startsWith(one + path.sep) || file.startsWith(two + path.sep);
  return { dir, one, two, inside };
}

test('resolveMention prefers the first base and falls back in order', () => {
  const { dir, one, two, inside } = layout();
  try {
    assert.equal(resolveMention('src/shared.ts', [one, one, two], inside), path.join(one, 'src/shared.ts'));
    assert.equal(resolveMention('src/only.ts', [one, one, two], inside), path.join(two, 'src/only.ts'));
    assert.equal(resolveMention('src/missing.ts', [one, two], inside), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveMention accepts absolute paths only inside the allowed folders', () => {
  const { dir, one, two, inside } = layout();
  try {
    assert.equal(resolveMention(path.join(two, 'src/only.ts'), [one], inside), path.join(two, 'src/only.ts'));
    assert.equal(resolveMention(path.join(dir, 'outside.ts'), [one], inside), null);
    assert.equal(resolveMention('../outside.ts', [one], inside), null);
    assert.equal(resolveMention('src', [one], inside), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('firstChangedLine looks for the new text, then the old, and takes the earliest line', () => {
  const text = 'a\nb\nnew two\nd\nnew one\n';
  assert.equal(firstChangedLine(text, [{ old_string: 'x', new_string: 'new one' }, { old_string: 'y', new_string: 'new two' }]), 3);
  assert.equal(firstChangedLine('a\nold\n', [{ old_string: 'old', new_string: 'gone' }]), 2);
  assert.equal(firstChangedLine('a\n', [{ old_string: 'old', new_string: '' }]), null);
  assert.equal(firstChangedLine('a\n', []), null);
});

test('replacementsOf reads Edit and MultiEdit inputs', () => {
  assert.deepEqual(replacementsOf({ file_path: 'a', old_string: 'x', new_string: 'y' }), [{ old_string: 'x', new_string: 'y' }]);
  assert.deepEqual(replacementsOf({ file_path: 'a', edits: [{ old_string: 'x', new_string: 'y' }, 3] }), [{ old_string: 'x', new_string: 'y' }]);
  assert.deepEqual(replacementsOf({ file_path: 'a', content: 'c' }), []);
  assert.deepEqual(replacementsOf(null), []);
});
