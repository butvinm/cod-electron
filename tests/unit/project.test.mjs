import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { visibleRows, navigate } = require('../../src/renderer/project-tree.js');
const { Folders } = require('../../src/folders.cjs');
const { readDir } = require('../../src/project-fs.cjs');

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
  const folders = new Folders();
  folders.add('a', ['/x/one']);
  assert.equal(folders.contains('/x/one/deep/file'), true);
  assert.equal(folders.contains('/x/one'), true);
  assert.equal(folders.contains('/x/one/../two'), false);
  assert.equal(folders.contains('/x/onetwo'), false);
  assert.equal(folders.workspaceContains('b', '/x/one/f'), false);
  assert.equal(folders.workspaceContains('a', '/x/one/f'), true);
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
