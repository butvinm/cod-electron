import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createQuitGuard } = require('../../src/agents/quit-guard.cjs');

const request = guard => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; guard(event); return event; };

test('repeated quit requests are all held until the one cleanup finishes, then quit once', async () => {
  let release;
  let cleanups = 0;
  let quits = 0;
  const guard = createQuitGuard({ cleanup: () => { cleanups++; return new Promise(resolve => { release = resolve; }); }, capMs: 5000, quit: () => { quits++; } });
  assert.equal(request(guard).prevented, true);
  assert.equal(request(guard).prevented, true);
  assert.equal(request(guard).prevented, true);
  assert.equal(cleanups, 1);
  assert.equal(quits, 0);
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(quits, 1);
  assert.equal(request(guard).prevented, false);
});

test('a cleanup that never finishes is cut off by the cap', async () => {
  let quits = 0;
  const guard = createQuitGuard({ cleanup: () => new Promise(() => {}), capMs: 30, quit: () => { quits++; } });
  request(guard);
  assert.equal(request(guard).prevented, true);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(quits, 1);
  assert.equal(request(guard).prevented, false);
});
