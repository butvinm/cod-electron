import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Folders } = require('../../src/folders.cjs');
const { EditorFiles } = require('../../src/editor-files.cjs');

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cod-editor-files-')));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside.txt');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello\n');
  fs.writeFileSync(outside, 'secret');
  fs.symlinkSync(outside, path.join(root, 'link.txt'));
  const folders = new Folders();
  folders.add('ws-1', [root]);
  return { base, root, outside, files: new EditorFiles(folders) };
}

test('reads and writes a file inside the workspace', () => {
  const { base, root, files } = setup();
  const file = path.join(root, 'a.txt');
  assert.equal(files.read('ws-1', file), 'hello\n');
  files.write('ws-1', file, 'changed');
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed');
  fs.rmSync(base, { recursive: true });
});

test('refuses paths outside the workspace and symlinks that leave it', () => {
  const { base, root, outside, files } = setup();
  assert.throws(() => files.read('ws-1', outside), /Not inside/);
  assert.throws(() => files.write('ws-1', outside, 'x'), /Not inside/);
  assert.throws(() => files.read('ws-1', path.join(root, 'link.txt')), /Not inside/);
  assert.throws(() => files.write('ws-1', path.join(root, 'link.txt'), 'x'), /Not inside/);
  assert.throws(() => files.read('ws-2', path.join(root, 'a.txt')), /Not inside/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'secret');
  fs.rmSync(base, { recursive: true });
});

test('does not create files or read directories and binaries', () => {
  const { base, root, files } = setup();
  assert.throws(() => files.write('ws-1', path.join(root, 'new.txt'), 'x'), /Not inside/);
  assert.throws(() => files.read('ws-1', root), /Not a file/);
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
  assert.throws(() => files.read('ws-1', path.join(root, 'bin.dat')), /Binary/);
  fs.rmSync(base, { recursive: true });
});
