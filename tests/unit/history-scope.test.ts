import test from 'node:test';
import assert from 'node:assert/strict';
import { historyKeyApplies } from '../../src/shared/history-scope.ts';

// A stand-in for an element: closest() answers for the selectors it is given.
const inside = (...selectors: string[]) => ({ closest: (selector: string) => (selectors.some(s => selector.includes(s)) ? {} : null) });

test('Cmd-G opens history only from the chat or the open picker', () => {
  assert.equal(historyKeyApplies(inside('.claude-chat')), true);
  assert.equal(historyKeyApplies(inside('claude-session-picker')), true);
  assert.equal(historyKeyApplies(inside('.editor')), false);
  assert.equal(historyKeyApplies(null), false);
});
