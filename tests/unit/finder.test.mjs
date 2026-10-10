import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { search, matchPositions } = require('../../src/fuzzy.cjs');
const { walk } = require('../../src/file-index.cjs');

const entry = rel => ({ rel, lower: rel.toLowerCase() });

test('search matches characters in order, ignoring case and spaces', () => {
  const entries = ['alpha/First.txt', 'notes/first.txt', 'zeta.txt'].map(entry);
  const found = search(entries, 'F S T');
  assert.deepEqual(found.map(f => f.entry.rel).sort(), ['alpha/First.txt', 'notes/first.txt']);
  assert.deepEqual(search(entries, 'afst').map(f => f.entry.rel), ['alpha/First.txt']);
  assert.deepEqual(search(entries, ''), []);
});

test('search reports one position per query character and prefers the file name', () => {
  const [hit] = search([entry('src/main/main.cjs')], 'main');
  assert.equal(hit.positions.length, 4);
  assert.deepEqual(hit.positions, [9, 10, 11, 12]);
});

test('search ranks a file name match above a scattered folder match', () => {
  const entries = [entry('a/b/c/d/readme-notes.md'), entry('docs/readme.md')];
  assert.equal(search(entries, 'readme')[0].entry.rel, 'docs/readme.md');
});

test('a position is never reused: repeated query characters need repeated path characters', () => {
  assert.equal(matchPositions('a.txt', 'aa'), null);
  assert.equal(matchPositions('a.txt', 'aaa'), null);
  assert.deepEqual(matchPositions('a.txt', 'a'), [0]);
  assert.deepEqual(matchPositions('aa.txt', 'aa'), [0, 1]);
  assert.deepEqual(search([entry('a.txt')], 'aa'), []);
});

test('search keeps the best results when more files match than the limit', () => {
  const entries = [...Array.from({ length: 200 }, (_, i) => entry(`dir/deep/file${i}.txt`)), entry('f.txt')];
  const found = search(entries, 'f', 5);
  assert.equal(found.length, 5);
  assert.equal(found[0].entry.rel, 'f.txt');
});

test('search honors the limit', () => {
  const entries = Array.from({ length: 100 }, (_, i) => entry(`f${i}.txt`));
  assert.equal(search(entries, 'f', 10).length, 10);
});

test('walk lets a nested .gitignore negation override an outer rule', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-unit-walk-'));
  try {
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, '.gitignore'), '*.txt\n');
    writeFileSync(path.join(dir, 'sub/.gitignore'), '!keep.txt\n');
    for (const file of ['top.txt', 'sub/keep.txt', 'sub/drop.txt', 'sub/other.md']) writeFileSync(path.join(dir, file), 'x\n');
    const rels = (await walk(dir)).map(e => e.rel).sort();
    assert.deepEqual(rels, ['.gitignore', 'sub/.gitignore', 'sub/keep.txt', 'sub/other.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('walk skips symlinks that lead outside the root, and keeps ones that stay inside', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'cod-unit-walk-'));
  try {
    const dir = path.join(base, 'root');
    mkdirSync(dir);
    writeFileSync(path.join(base, 'secret.txt'), 'x\n');
    writeFileSync(path.join(base, 'outer.gitignore'), 'inside.txt\n');
    writeFileSync(path.join(dir, 'real.txt'), 'x\n');
    writeFileSync(path.join(dir, 'inside.txt'), 'x\n');
    symlinkSync(path.join(base, 'secret.txt'), path.join(dir, 'leak.txt'));
    symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'alias.txt'));
    symlinkSync(path.join(base, 'outer.gitignore'), path.join(dir, '.gitignore'));
    const rels = (await walk(dir)).map(e => e.rel).sort();
    assert.deepEqual(rels, ['alias.txt', 'inside.txt', 'real.txt']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('walk skips .git, ignored files and folders, and applies nested .gitignore', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cod-unit-walk-'));
  try {
    mkdirSync(path.join(dir, '.git'));
    mkdirSync(path.join(dir, 'build'));
    mkdirSync(path.join(dir, 'cache'));
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, '.gitignore'), 'build/\nignored.txt\ncache/*\n!cache/keep.txt\n');
    writeFileSync(path.join(dir, 'sub/.gitignore'), 'local.txt\n');
    for (const file of ['.git/config', 'build/out.js', 'ignored.txt', 'cache/x.txt', 'cache/keep.txt', 'sub/local.txt', 'sub/kept.txt', 'local.txt', 'main.js']) {
      writeFileSync(path.join(dir, file), 'x\n');
    }
    const rels = (await walk(dir)).map(e => e.rel).sort();
    assert.deepEqual(rels, ['.gitignore', 'cache/keep.txt', 'local.txt', 'main.js', 'sub/.gitignore', 'sub/kept.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
