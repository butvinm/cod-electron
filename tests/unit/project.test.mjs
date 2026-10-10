import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { visibleRows, navigate } = require('../../src/renderer/project-tree.js');
const { Folders } = require('../../src/folders.cjs');
const { readDir, compare } =require('../../src/project-fs.cjs');

test('readDir lists folders first, natural case-insensitive order, without .git', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-unit-'));
  try {
    for (const d of ['.git', 'alpha', 'Beta']) mkdirSync(path.join(dir, d));
    for (const f of ['Zebra.txt', 'file10.txt', 'file2.txt', '.env', 'apple.txt']) writeFileSync(path.join(dir, f), '');
    assert.deepEqual(readDir(dir).map(e => e.name), ['alpha', 'Beta', '.env', 'apple.txt', 'file2.txt', 'file10.txt', 'Zebra.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Folders keeps roots per workspace, skips duplicates and emits change', () => {
  const folders = new Folders();
  const events = [];
  folders.on('change', e => events.push(e));
  assert.deepEqual(folders.add('a', ['/x/one', '/x/two']), ['/x/one', '/x/two']);
  assert.deepEqual(folders.add('a', ['/x/one']), []);
  folders.add('b', ['/y']);
  assert.deepEqual(folders.list('a'), ['/x/one', '/x/two']);
  assert.deepEqual(folders.list('b'), ['/y']);
  assert.equal(events.length, 2);
  assert.throws(() => folders.add('a', ['relative']));
});

test('Folders.contains only accepts paths inside a root', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'cod-unit-'));
  try {
    const one = path.join(base, 'one');
    for (const d of [one, path.join(one, 'deep'), path.join(one, '..cache'), path.join(base, 'onetwo'), path.join(base, 'two')]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(one, 'deep', 'file'), '');
    writeFileSync(path.join(one, 'f'), '');
    const folders = new Folders();
    folders.add('a', [one]);
    assert.equal(folders.contains(path.join(one, 'deep', 'file')), true);
    assert.equal(folders.contains(one), true);
    assert.equal(folders.contains(path.join(one, '..cache')), true);
    assert.equal(folders.contains(path.join(one, '..', 'two')), false);
    assert.equal(folders.contains(path.join(base, 'onetwo')), false);
    assert.equal(folders.contains(path.join(one, 'missing')), false);
    assert.equal(folders.workspaceContains('b', path.join(one, 'f')), false);
    assert.equal(folders.workspaceContains('a', path.join(one, 'f')), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('Folders.contains rejects symlinks that lead out of a root but accepts ones that stay inside', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'cod-unit-'));
  try {
    const one = path.join(base, 'one');
    const outside = path.join(base, 'outside');
    mkdirSync(path.join(one, 'real'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), '');
    writeFileSync(path.join(one, 'real', 'ok.txt'), '');
    symlinkSync(outside, path.join(one, 'dir-link'));
    symlinkSync(path.join(outside, 'secret.txt'), path.join(one, 'file-link'));
    symlinkSync(path.join(one, 'real'), path.join(one, 'inner-link'));
    const folders = new Folders();
    folders.add('a', [one]);
    assert.equal(folders.contains(path.join(one, 'dir-link')), false);
    assert.equal(folders.contains(path.join(one, 'dir-link', 'secret.txt')), false);
    assert.equal(folders.contains(path.join(one, 'file-link')), false);
    assert.equal(folders.contains(path.join(one, 'inner-link', 'ok.txt')), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('compare puts folders first, ignores case, is natural, and puts lowercase first on ties', () => {
  const file = name => ({ name, isDirectory: false });
  const dir = name => ({ name, isDirectory: true });
  const sorted = list => [...list].sort(compare).map(e => e.name);
  assert.deepEqual(sorted([file('a'), dir('Z')]), ['Z', 'a']);
  assert.deepEqual(sorted([file('B'), file('a'), file('c')]), ['a', 'B', 'c']);
  assert.deepEqual(sorted([file('file10'), file('file2')]), ['file2', 'file10']);
  assert.deepEqual(sorted([file('Readme'), file('readme')]), ['readme', 'Readme']);
  assert.deepEqual(sorted([dir('Src'), dir('src')]), ['src', 'Src']);
});

const listings = {
  '/r': [{ name: 'd', path: '/r/d', isDirectory: true }, { name: 'f', path: '/r/f', isDirectory: false }],
  '/r/d': [{ name: 'g', path: '/r/d/g', isDirectory: false }],
};
const rows = expanded => visibleRows(['/r'], new Set(expanded), listings);

test('visibleRows hides children of collapsed folders', () => {
  assert.deepEqual(rows(['/r']).map(r => r.path), ['/r', '/r/d', '/r/f']);
  assert.deepEqual(rows(['/r', '/r/d']).map(r => r.path), ['/r', '/r/d', '/r/d/g', '/r/f']);
});

test('navigate moves, expands, collapses and opens like Zed', () => {
  const all = rows(['/r', '/r/d']);
  assert.deepEqual(navigate(all, null, 'ArrowDown'), { select: '/r' });
  assert.deepEqual(navigate(all, '/r/d', 'ArrowDown'), { select: '/r/d/g' });
  assert.deepEqual(navigate(all, '/r/f', 'ArrowDown'), { select: '/r/f' });
  assert.deepEqual(navigate(all, '/r/d', 'ArrowUp'), { select: '/r' });
  assert.deepEqual(navigate(all, '/r/d', 'ArrowRight'), { select: '/r/d/g' });
  assert.deepEqual(navigate(rows(['/r']), '/r/d', 'ArrowRight'), { expand: '/r/d' });
  assert.deepEqual(navigate(all, '/r/d', 'ArrowLeft'), { collapse: '/r/d' });
  assert.deepEqual(navigate(all, '/r/d/g', 'ArrowLeft'), { select: '/r/d' });
  assert.equal(navigate(all, '/r', 'ArrowLeft').collapse, '/r');
  assert.deepEqual(navigate(all, '/r/f', 'Enter'), { open: '/r/f' });
  assert.equal(navigate(all, '/r/d', 'Enter'), null);
  assert.equal(navigate(all, '/r/f', 'x'), null);
});
