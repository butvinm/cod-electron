import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createQuitFlow } = createRequire(import.meta.url)('../../src/quit-flow.cjs');

const makeEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(answer) {
  const log = [];
  const flow = createQuitFlow({
    askPage: async () => { log.push('ask'); return answer; },
    chatGuard: event => { log.push('guard'); event.preventDefault(); },
    quit: () => log.push('quit'),
  });
  return { flow, log };
}

test('quit asks the page first and holds the quit meanwhile', async () => {
  const { flow, log } = setup(true);
  const event = makeEvent();
  flow.beforeQuit(event);
  assert.equal(event.prevented, true);
  await tick();
  assert.deepEqual(log, ['ask', 'quit']);
});

test('Cancel stops the quit and a later request asks again', async () => {
  const { flow, log } = setup(false);
  flow.beforeQuit(makeEvent());
  await tick();
  flow.beforeQuit(makeEvent());
  await tick();
  assert.deepEqual(log, ['ask', 'ask']);
});

test('a page that fails to answer keeps the app open', async () => {
  const flow = createQuitFlow({ askPage: async () => { throw new Error('gone'); }, chatGuard: () => assert.fail(), quit: () => assert.fail() });
  flow.beforeQuit(makeEvent());
  await tick();
});

test('after a yes, later quit requests go to the chat cleanup without asking again', async () => {
  const { flow, log } = setup(true);
  flow.beforeQuit(makeEvent());
  await tick();
  flow.beforeQuit(makeEvent());
  assert.deepEqual(log, ['ask', 'quit', 'guard']);
});

test('window close stays prevented while the chat cleanup is pending, and opens after it', async () => {
  const { flow, log } = setup(true);
  const first = makeEvent();
  flow.windowClose(first);
  assert.equal(first.prevented, true);
  await tick();
  const pending = makeEvent();
  flow.windowClose(pending);
  assert.equal(pending.prevented, true);
  assert.deepEqual(log, ['ask', 'quit']);
  flow.cleanupFinished();
  const done = makeEvent();
  flow.windowClose(done);
  assert.equal(done.prevented, false);
});

test('window close does not ask twice while the first prompt is open', async () => {
  const { flow, log } = setup(true);
  flow.windowClose(makeEvent());
  flow.windowClose(makeEvent());
  await tick();
  assert.deepEqual(log, ['ask', 'quit']);
});
