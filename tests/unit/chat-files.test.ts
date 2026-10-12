import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMention, confineFile, firstChangedLine, changedLine, replacementsOf } from '../../src/chat-files.ts';
import { Folders } from '../../src/folders.ts';

function layout() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cod-chat-files-')));
  const one = path.join(dir, 'one');
  const two = path.join(dir, 'two');
  for (const root of [one, two]) fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(one, 'src/shared.ts'), 'one');
  fs.writeFileSync(path.join(two, 'src/shared.ts'), 'two');
  fs.writeFileSync(path.join(two, 'src/only.ts'), 'two');
  fs.writeFileSync(path.join(dir, 'outside.ts'), 'out');
  fs.symlinkSync(path.join(dir, 'outside.ts'), path.join(one, 'src/escape.ts'));
  return { dir, one, two };
}

test('resolveMention prefers the first root and falls back in order', () => {
  const { dir, one, two } = layout();
  try {
    assert.equal(resolveMention('src/shared.ts', [one, two]), path.join(one, 'src/shared.ts'));
    assert.equal(resolveMention('src/only.ts', [one, two]), path.join(two, 'src/only.ts'));
    assert.equal(resolveMention('src/missing.ts', [one, two]), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveMention accepts absolute paths only inside the roots, and not symlinks that leave them', () => {
  const { dir, one, two } = layout();
  try {
    assert.equal(resolveMention(path.join(two, 'src/only.ts'), [one, two]), path.join(two, 'src/only.ts'));
    assert.equal(resolveMention(path.join(dir, 'outside.ts'), [one]), null);
    assert.equal(resolveMention('../outside.ts', [one]), null);
    assert.equal(resolveMention('src/escape.ts', [one]), null);
    assert.equal(resolveMention('src', [one]), null);
    assert.equal(resolveMention(42, [one]), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a path outside every root never reaches the file system', () => {
  const calls: string[] = [];
  const probe = {
    realpathSync: (target: string) => { calls.push(target); return target; },
    statSync: (target: string) => { calls.push(target); return { isFile: () => true }; },
  };
  assert.equal(confineFile('/elsewhere/x.ts', ['/work/one'], probe), null);
  assert.equal(resolveMention('../../etc/passwd', ['/work/one'], probe), null);
  assert.equal(resolveMention('/work/one/../two/x.ts', ['/work/one'], probe), null);
  assert.deepEqual(calls, []);
  assert.equal(confineFile('/work/one/x.ts', ['/work/one'], probe), '/work/one/x.ts');
  assert.ok(calls.length > 0);
});

test('Folders.contains checks the roots before touching the path, and counts extra roots', () => {
  const { dir, one, two } = layout();
  try {
    const folders = new Folders();
    folders.byWorkspace.set('w', [one]);
    assert.equal(folders.workspaceContains('w', path.join(one, 'src/shared.ts')), true);
    assert.equal(folders.workspaceContains('w', path.join(one, '../outside.ts')), false);
    assert.equal(folders.workspaceContains('w', path.join(one, 'src/escape.ts')), false);
    assert.equal(folders.workspaceContains('w', path.join(two, 'src/only.ts')), false);
    folders.extraRoots = () => [two];
    assert.equal(folders.workspaceContains('w', path.join(two, 'src/only.ts')), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('changedLine skips the part shared with the old text', () => {
  assert.equal(changedLine('a\nkeep\nNEW\nz\n', { old_string: 'keep\nOLD', new_string: 'keep\nNEW' }), 3);
  assert.equal(changedLine('a\nkeep\nOLD\nz\n', { old_string: 'keep\nOLD', new_string: 'keep\nNEW' }), 3);
});

test('changedLine points a deletion at the line where the text was, before the edit', () => {
  assert.equal(changedLine('a\nb\ngone\nc\n', { old_string: 'gone\n', new_string: '' }), 3);
  assert.equal(changedLine('a\nb\nc\n', { old_string: 'gone\n', new_string: '' }), null);
});

test('changedLine uses the old text first so repeated new text does not mislead', () => {
  assert.equal(changedLine('same\nsame\nold\n', { old_string: 'old', new_string: 'same' }), 3);
});

test('firstChangedLine takes the earliest line of any replacement', () => {
  const text = 'a\nb\nnew two\nd\nnew one\n';
  assert.equal(firstChangedLine(text, [{ old_string: 'x', new_string: 'new one' }, { old_string: 'y', new_string: 'new two' }]), 3);
  assert.equal(firstChangedLine('a\n', []), null);
});

test('replacementsOf reads Edit and MultiEdit inputs', () => {
  assert.deepEqual(replacementsOf({ file_path: 'a', old_string: 'x', new_string: 'y' }), [{ old_string: 'x', new_string: 'y' }]);
  assert.deepEqual(replacementsOf({ file_path: 'a', edits: [{ old_string: 'x', new_string: 'y' }, 3] }), [{ old_string: 'x', new_string: 'y' }]);
  assert.deepEqual(replacementsOf({ file_path: 'a', content: 'c' }), []);
  assert.deepEqual(replacementsOf(null), []);
});
