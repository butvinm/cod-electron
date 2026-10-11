import test from 'node:test';
import assert from 'node:assert/strict';
import type { EventChannels, InvokeArgs, InvokeResult, SendChannels } from '../../src/shared/ipc.ts';

// These checks are made by tsc (npm run typecheck): an unused @ts-expect-error is itself an error,
// so each line below fails the type check if a wrong payload ever compiles.
type Send = <K extends keyof EventChannels>(channel: K, payload: EventChannels[K]) => void;
const send: Send = () => {};
const invokeArgs = <K extends keyof import('../../src/shared/ipc.ts').InvokeChannels>(_channel: K, ..._args: InvokeArgs<K>): void => {};

test('the IPC contract rejects wrong payloads at compile time', () => {
  send('quit:ask', 1);
  // @ts-expect-error quit:ask carries a number
  send('quit:ask', 'one');
  // @ts-expect-error unknown channel
  send('no-such-channel', 1);
  invokeArgs('editor:read', 'ws-1', '/a');
  // @ts-expect-error editor:read needs a file
  invokeArgs('editor:read', 'ws-1');
  const answer: SendChannels['quit:answer'] = [1, true];
  const result: InvokeResult<'project:roots'> = ['/a'];
  assert.deepEqual([answer, result], [[1, true], ['/a']]);
});
