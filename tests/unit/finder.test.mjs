import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { search } = require('../../src/fuzzy.cjs');
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

test('search honors the limit', () => {
  const entries = Array.from({ length: 100 }, (_, i) => entry(`f${i}.txt`));
  assert.equal(search(entries, 'f', 10).length, 10);
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
