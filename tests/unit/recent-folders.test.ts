import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushRecent, cleanRecent, RecentFolders } from '../../src/recent-folders.ts';

test('pushRecent puts the folder first and removes its older copy', () => {
  assert.deepEqual(pushRecent(['/a', '/b', '/c'], '/b'), ['/b', '/a', '/c']);
  assert.deepEqual(pushRecent([], '/a'), ['/a']);
});

test('pushRecent keeps at most max entries', () => {
  assert.deepEqual(pushRecent(['/a', '/b'], '/c', 2), ['/c', '/a']);
});

test('cleanRecent drops anything but absolute strings and repeats', () => {
  assert.deepEqual(cleanRecent(['/a', 3, 'rel', '/a', '/b']), ['/a', '/b']);
  assert.deepEqual(cleanRecent({ not: 'a list' }), []);
});

test('RecentFolders persists across instances, most recent first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-recent-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const file = path.join(dir, 'profile', 'recent-folders.json');
    const first = new RecentFolders(file);
    assert.deepEqual(first.get(), []);
    first.add([a]);
    first.add([b]);
    assert.deepEqual(new RecentFolders(file).get(), [b, a]);
    first.add([a, b]);
    assert.deepEqual(new RecentFolders(file).get(), [a, b]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RecentFolders hides deleted folders and survives a damaged file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-recent-'));
  try {
    const file = path.join(dir, 'recent.json');
    fs.writeFileSync(file, '{broken');
    const store = new RecentFolders(file);
    assert.deepEqual(store.get(), []);
    store.add([path.join(dir, 'gone')]);
    assert.deepEqual(store.get(), []);
    assert.ok(store.has(path.join(dir, 'gone')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
