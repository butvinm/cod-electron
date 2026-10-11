import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, answerText, answersOf, isAnswered, nextRow, parseQuestions, type Question } from '../../src/renderer/question-model.ts';
import { createChat, reduce } from '../../src/renderer/chat-model.ts';

const single: Question = { header: 'Size', question: 'Which size?', multiSelect: false, options: [{ label: 'Small', description: 'a' }, { label: 'Large', description: 'b' }] };
const multi: Question = { header: 'Parts', question: 'Which parts?', multiSelect: true, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }, { label: 'C', description: '' }] };

test('parseQuestions reads questions and refuses unusable input', () => {
  assert.deepEqual(parseQuestions({ questions: [single] }), [single]);
  assert.equal(parseQuestions({}), null);
  assert.equal(parseQuestions({ questions: [] }), null);
  assert.equal(parseQuestions({ questions: [{ question: 'x', options: [{ description: 'no label' }] }] }), null);
  assert.equal(parseQuestions(null), null);
});

test('answers are a label, labels joined with a comma, or the typed text', () => {
  assert.equal(answerText(single, { picked: [1], other: null }), 'Large');
  assert.equal(answerText(multi, { picked: [2, 0], other: null }), 'A, C');
  assert.equal(answerText(multi, { picked: [], other: 'my own' }), 'my own');
  assert.deepEqual(answersOf([single, multi], [{ picked: [0], other: null }, { picked: [1], other: null }]), { 'Which size?': 'Small', 'Which parts?': 'B' });
});

test('a question needs a choice or Other text to count as answered', () => {
  assert.equal(isAnswered({ picked: [], other: null }), false);
  assert.equal(isAnswered({ picked: [], other: '' }), false);
  assert.equal(isAnswered({ picked: [], other: 'x' }), true);
  assert.equal(isAnswered({ picked: [0], other: null }), true);
});

test('reselecting Other after a named option starts empty, so the field and the answer agree', () => {
  const other = single.options.length;
  let choice = choose(single, { picked: [], other: null }, other, false);
  assert.deepEqual(choice, { picked: [], other: '' });
  choice = { ...choice, other: 'Custom size' };
  choice = choose(single, choice, 0, false);
  assert.deepEqual(choice, { picked: [0], other: null });
  choice = choose(single, choice, other, false);
  assert.deepEqual(choice, { picked: [], other: '' });
  assert.equal(isAnswered(choice), false);
});

test('multiple choice toggles options and Other independently', () => {
  const other = multi.options.length;
  let choice = choose(multi, { picked: [], other: null }, 0, true);
  choice = choose(multi, choice, other, true);
  assert.deepEqual(choice, { picked: [0], other: '' });
  choice = choose(multi, { ...choice, other: 'x' }, other, true);
  assert.deepEqual(choice, { picked: [0], other: null });
});

test('nextRow moves with arrows, stops at the ends and jumps with 1-4', () => {
  assert.equal(nextRow(0, 'ArrowDown', 3), 1);
  assert.equal(nextRow(3, 'ArrowDown', 3), 3);
  assert.equal(nextRow(0, 'ArrowUp', 3), 0);
  assert.equal(nextRow(2, 'ArrowUp', 3), 1);
  assert.equal(nextRow(0, '3', 3), 2);
  assert.equal(nextRow(1, '4', 3), 1);
});

test('answering a question leaves the queue and stays in the transcript', () => {
  let state = reduce(createChat(), { type: 'permission-request', id: 'p1', tool: 'AskUserQuestion', input: { questions: [single] } });
  assert.equal(state.permission?.id, 'p1');
  state = reduce(state, { type: 'questions-answered', id: 'p1', questions: [single], answers: { 'Which size?': 'Small' } });
  assert.equal(state.permission, null);
  const item = state.items[state.items.length - 1];
  assert.equal(item.kind, 'questions');
  assert.deepEqual(item.kind === 'questions' && item.answers, { 'Which size?': 'Small' });
});

test('declining a question leaves the queue and keeps a declined item', () => {
  let state = reduce(createChat(), { type: 'permission-request', id: 'p1', tool: 'AskUserQuestion', input: { questions: [single] } });
  state = reduce(state, { type: 'questions-declined', id: 'p1', questions: [single] });
  assert.equal(state.permission, null);
  const item = state.items[state.items.length - 1];
  assert.equal(item.kind, 'declined');
  assert.deepEqual(item.kind === 'declined' && item.questions, [single]);
});
