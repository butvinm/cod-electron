import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAge, filterSessions } from '../../src/renderer/session-picker.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('formatAge uses the compact units of Zed', () => {
  const now = 1_000 * DAY;
  assert.equal(formatAge(now - 20_000, now), 'Just now');
  assert.equal(formatAge(now - 5 * MINUTE, now), '5m');
  assert.equal(formatAge(now - 3 * HOUR, now), '3h');
  assert.equal(formatAge(now - 2 * DAY - HOUR, now), '2d');
  assert.equal(formatAge(now - 6 * DAY, now), '6d');
  assert.equal(formatAge(now - 15 * DAY, now), '2w');
  assert.equal(formatAge(now - 90 * DAY, now), '3mo');
  assert.equal(formatAge(now - 800 * DAY, now), '2y');
  assert.equal(formatAge(now + HOUR, now), 'Just now');
});

test('filterSessions keeps the order and matches every word of the title', () => {
  const sessions = ['Fix the login bug', 'Plan the release', 'Login page styles'].map((title, i) => ({ id: String(i), folder: '/f', title, updated: 3 - i }));
  assert.deepEqual(filterSessions(sessions, 'LOGIN').map(s => s.id), ['0', '2']);
  assert.deepEqual(filterSessions(sessions, 'login page').map(s => s.id), ['2']);
  assert.deepEqual(filterSessions(sessions, '  ').map(s => s.id), ['0', '1', '2']);
  assert.deepEqual(filterSessions(sessions, 'nothing'), []);
});
