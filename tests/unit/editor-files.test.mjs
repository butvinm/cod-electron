import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Folders } = require('../../src/folders.cjs');
const { EditorFiles } = require('../../src/editor-files.cjs');

function setup(options) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cod-editor-files-')));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside.txt');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello\n');
  fs.writeFileSync(outside, 'secret');
  fs.symlinkSync(outside, path.join(root, 'link.txt'));
  const folders = new Folders();
  folders.add('ws-1', [root]);
  return { base, root, outside, file: path.join(root, 'a.txt'), files: new EditorFiles(folders, options) };
}

const cleanup = ({ base }) => fs.rmSync(base, { recursive: true });
const plain = text => ({ text, eol: 'lf', bom: false });

test('reads and writes a file inside the workspace', () => {
  const s = setup();
  assert.deepEqual(s.files.read('ws-1', s.file), { text: 'hello\n', eol: 'lf', bom: false });
  s.files.write('ws-1', s.file, plain('changed'));
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'changed');
  cleanup(s);
});

test('refuses paths outside the workspace and symlinks that leave it', () => {
  const s = setup();
  assert.throws(() => s.files.read('ws-1', s.outside), /Not inside/);
  assert.throws(() => s.files.write('ws-1', s.outside, plain('x')), /Not inside/);
  assert.throws(() => s.files.read('ws-1', path.join(s.root, 'link.txt')), /Not inside/);
  assert.throws(() => s.files.write('ws-1', path.join(s.root, 'link.txt'), plain('x')), /Not inside/);
  assert.throws(() => s.files.read('ws-2', s.file), /Not inside/);
  assert.equal(fs.readFileSync(s.outside, 'utf8'), 'secret');
  cleanup(s);
});

test('does not create files or read directories', () => {
  const s = setup();
  assert.throws(() => s.files.write('ws-1', path.join(s.root, 'new.txt'), plain('x')), /Not inside/);
  assert.throws(() => s.files.read('ws-1', s.root), /Not a file/);
  assert.deepEqual(fs.readdirSync(s.root).sort(), ['a.txt', 'link.txt']);
  cleanup(s);
});

// Byte-level round trips: what was opened is written back unchanged.
const roundTrips = {
  lf: Buffer.from('one\ntwo\n'),
  crlf: Buffer.from('one\r\ntwo\r\n'),
  cr: Buffer.from('one\rtwo\r'),
  bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\ntwo')]),
  'bom and crlf': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo')]),
  'no final newline': Buffer.from('one'),
  utf8: Buffer.from('café 中文\n'),
  empty: Buffer.alloc(0),
};

for (const [name, bytes] of Object.entries(roundTrips)) {
  test(`round trip keeps the bytes: ${name}`, () => {
    const s = setup();
    fs.writeFileSync(s.file, bytes);
    const contents = s.files.read('ws-1', s.file);
    assert.ok(!contents.text.includes('\r'), 'editor text uses \\n only');
    s.files.write('ws-1', s.file, contents);
    assert.deepEqual(fs.readFileSync(s.file), bytes);
    cleanup(s);
  });
}

test('reports line ending and BOM', () => {
  const s = setup();
  fs.writeFileSync(s.file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb')]));
  assert.deepEqual(s.files.read('ws-1', s.file), { text: 'a\nb', eol: 'crlf', bom: true });
  cleanup(s);
});

test('refuses invalid UTF-8, binary and mixed line endings without touching the file', () => {
  const s = setup();
  const cases = [
    [Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]), /not valid UTF-8/],
    [Buffer.from([0x61, 0x00, 0x62]), /Binary/],
    [Buffer.from('a\r\nb\nc'), /mixes line endings/],
    [Buffer.from('a\rb\nc'), /mixes line endings/],
  ];
  for (const [bytes, message] of cases) {
    fs.writeFileSync(s.file, bytes);
    assert.throws(() => s.files.read('ws-1', s.file), message);
    assert.deepEqual(fs.readFileSync(s.file), bytes);
  }
  cleanup(s);
});

test('a failed write keeps the original bytes and leaves no temp file', () => {
  const failing = { ...fs, writeSync() { throw new Error('No space left on device'); } };
  const s = setup({ fsImpl: failing });
  assert.throws(() => s.files.write('ws-1', s.file, plain('new text')), /No space/);
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'hello\n');
  assert.deepEqual(fs.readdirSync(s.root).sort(), ['a.txt', 'link.txt']);
  cleanup(s);
});

test('a failed rename keeps the original bytes and leaves no temp file', () => {
  const failing = { ...fs, renameSync() { throw new Error('rename failed'); } };
  const s = setup({ fsImpl: failing });
  assert.throws(() => s.files.write('ws-1', s.file, plain('new text')), /rename failed/);
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'hello\n');
  assert.deepEqual(fs.readdirSync(s.root).sort(), ['a.txt', 'link.txt']);
  cleanup(s);
});

test('a save keeps the file mode', () => {
  const s = setup();
  fs.chmodSync(s.file, 0o640);
  s.files.write('ws-1', s.file, plain('x'));
  assert.equal(fs.statSync(s.file).mode & 0o7777, 0o640);
  cleanup(s);
});

test('a target swapped for a symlink out of the workspace is not written', () => {
  const hooks = {};
  const s = setup({ hooks });
  hooks.beforeCommit = (_temp, real) => {
    fs.unlinkSync(real);
    fs.symlinkSync(s.outside, real);
  };
  assert.throws(() => s.files.write('ws-1', s.file, plain('overwritten')), /changed while saving/);
  assert.equal(fs.readFileSync(s.outside, 'utf8'), 'secret');
  assert.deepEqual(fs.readdirSync(s.root).filter(name => name.endsWith('.tmp')), []);
  cleanup(s);
});

test('a directory swapped for a symlink out of the workspace is not written through', () => {
  const hooks = {};
  const s = setup({ hooks });
  const sub = path.join(s.root, 'sub');
  const elsewhere = path.join(s.base, 'elsewhere');
  fs.mkdirSync(sub);
  fs.mkdirSync(elsewhere);
  const file = path.join(sub, 'b.txt');
  fs.writeFileSync(file, 'inside');
  fs.writeFileSync(path.join(elsewhere, 'b.txt'), 'outside');
  hooks.beforeCommit = () => {
    fs.renameSync(sub, path.join(s.base, 'moved'));
    fs.symlinkSync(elsewhere, sub);
  };
  assert.throws(() => s.files.write('ws-1', file, plain('overwritten')));
  assert.equal(fs.readFileSync(path.join(elsewhere, 'b.txt'), 'utf8'), 'outside');
  cleanup(s);
});
