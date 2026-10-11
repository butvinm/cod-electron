import { test, expect, pending, chat, form, group, option, submit, replies, response, chooseFirstAndSubmit } from './helpers/ask-user-question';

test.describe('question rendering', () => {
  test.use({ questionScenario: 'ask-user-question-counts' });

  test('AC1: one to four questions show headers, text and options without a raw permission prompt', async ({ cod: { page }, questionFake: fake }, testInfo) => {
    for (let index = 0; index < 4; index++) {
      await pending(page, fake, index);
      const questions = fake.requests[index]!.input.questions;
      await expect(form(page).getByRole('group')).toHaveCount(questions.length);
      for (const question of questions) {
        await expect(group(page, question)).toContainText(question.header);
        await expect(group(page, question)).toContainText(question.question);
        for (const choice of question.options) {
          await expect(option(page, question, choice.label)).toBeVisible();
          await expect(group(page, question).getByText(choice.description, { exact: true })).toBeVisible();
        }
      }
      await expect(chat(page).getByTestId('chat-permission-prompt')).toBeHidden();
      await expect(chat(page).getByText('Claude wants to use AskUserQuestion', { exact: false })).toBeHidden();
      if (index === 3) await testInfo.attach('four-option-question-look-check', { body: await page.screenshot(), contentType: 'image/png' });
      await chooseFirstAndSubmit(page, questions);
      await response(fake, index);
      await expect(form(page)).toBeHidden();
      await expect(replies(page)).toHaveCount(index + 1);
      await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
    }
  });
});

test('AC2: arrows and keys 1-4 select single choices and Enter advances focus to Submit', async ({ cod: { page }, questionFake: fake }) => {
  await pending(page, fake);
  const questions = fake.requests[0]!.input.questions;
  const keys = [['ArrowDown', 'ArrowDown', 'ArrowUp', '2'], ['1'], ['3'], ['4']];
  const labels = ['Medium', 'Small', 'Large', 'Extra large'];
  for (const [index, question] of questions.entries()) {
    await expect(option(page, question, 'Small')).toBeFocused();
    for (const key of keys[index]!) {
      await page.keyboard.press(key);
      if (index === 0 && key === 'ArrowUp') await expect(option(page, question, 'Medium')).toBeFocused();
    }
    await expect(option(page, question, labels[index]!)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(option(page, question, labels[index]!)).toBeChecked();
    if (index < questions.length - 1) await expect(option(page, questions[index + 1]!, 'Small')).toBeFocused();
    else await expect(submit(page)).toBeFocused();
  }
  expect(fake.records().filter(record => record.kind === 'permission-answer')).toHaveLength(0);
});

test.describe('mixed answers', () => {
  test.use({ questionScenario: 'ask-user-question-mixed' });

  test('AC3: Space chooses two multiple-choice options and Enter keeps both chosen', async ({ cod: { page }, questionFake: fake }) => {
    await pending(page, fake);
    const questions = fake.requests[0]!.input.questions;
    await page.keyboard.press('Enter');
    await expect(option(page, questions[1]!, 'Small')).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await expect(option(page, questions[1]!, 'Small')).toBeChecked();
    await expect(option(page, questions[1]!, 'Medium')).toBeChecked();
    await expect(option(page, questions[1]!, 'Large')).not.toBeChecked();
    await expect(option(page, questions[2]!, 'Small')).toBeFocused();
  });

  test('AC4: Other accepts a typed answer instead of an option label', async ({ cod: { page }, questionFake: fake }) => {
    await pending(page, fake);
    const questions = fake.requests[0]!.input.questions;
    // Exercise Other for both single and multiple choice questions.
    const text = ['Custom "tiny" fixture', 'Custom pair of fixtures', 'Custom final fixture'];
    for (const [index, question] of questions.entries()) {
      for (let count = 0; count < question.options.length; count++) await page.keyboard.press('ArrowDown');
      await expect(option(page, question, 'Other')).toBeFocused();
      await page.keyboard.press(question.multiSelect ? 'Space' : 'Enter');
      const input = group(page, question).getByRole('textbox', { name: 'Other answer', exact: true });
      await expect(input).toBeFocused();
      await page.keyboard.insertText(text[index]!);
      await page.keyboard.press('Enter');
    }
    await expect(submit(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const record = await response(fake);
    expect(record.answer?.updatedInput?.answers).toEqual(Object.fromEntries(questions.map((question, index) => [question.question, text[index]])));
  });

  test('AC5: Submit sends labels, multiple labels and text to Claude and its next reply appears', async ({ cod: { page }, questionFake: fake }) => {
    await pending(page, fake);
    const questions = fake.requests[0]!.input.questions;
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    for (let i = 0; i < questions[2]!.options.length; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(group(page, questions[2]!).getByRole('textbox', { name: 'Other answer', exact: true })).toBeFocused();
    await page.keyboard.insertText('Tiny fixture with quoted "seed"');
    await page.keyboard.press('Enter');
    await expect(submit(page)).toBeFocused();
    expect(fake.records().filter(record => record.kind === 'permission-answer')).toHaveLength(0);
    await page.keyboard.press('Enter');
    const record = await response(fake);
    expect(record.request).toEqual(fake.requests[0]);
    expect(record.answer?.behavior).toBe('allow');
    expect(record.answer?.updatedInput?.questions).toEqual(questions);
    const answers = record.answer?.updatedInput?.answers;
    expect(answers?.[questions[0]!.question]).toBe('Medium');
    const multiple = answers?.[questions[1]!.question];
    // Claude's live check must settle array vs comma-separated labels; accept either shape.
    const labels = Array.isArray(multiple) ? multiple : multiple?.split(',').map(label => label.trim());
    expect(labels?.slice().sort()).toEqual(['Medium', 'Small']);
    expect(answers?.[questions[2]!.question]).toBe('Tiny fixture with quoted "seed"');
    expect(Object.keys(answers!)).toHaveLength(3);
    await expect(replies(page).last()).toContainText('Answers received. Continuing the fixture.');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
    await expect(form(page)).toBeHidden();
  });
});

test('AC6: Escape denies with the exact message and the chat continues', async ({ cod: { page }, questionFake: fake }) => {
  await pending(page, fake);
  await page.keyboard.press('Escape');
  const record = await response(fake);
  expect(record.answer).toEqual({ behavior: 'deny', message: 'The user declined to answer' });
  await expect(replies(page).last()).toContainText('Question declined: The user declined to answer. Continuing the fixture.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  await expect(form(page)).toBeHidden();
  expect(fake.records().filter(record => record.kind === 'signal')).toHaveLength(0);
  expect(fake.records().filter(record => record.kind === 'tool-run')).toHaveLength(0);
  await expect(chat(page).getByRole('textbox', { name: 'Message Claude', exact: true })).toBeEnabled();
});

test('AC7: submitted questions remain collapsed in history with each question and its answer', async ({ cod: { page }, questionFake: fake }) => {
  await pending(page, fake);
  const questions = fake.requests[0]!.input.questions;
  await chooseFirstAndSubmit(page, questions);
  await response(fake);
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  const history = chat(page).getByTestId('chat-question-history');
  await expect(history).toBeVisible();
  await expect(history.getByRole('button', { name: 'Questions and answers', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(history.getByTestId('chat-question-answer')).toHaveCount(questions.length);
  for (const [index, question] of questions.entries()) {
    const row = history.getByTestId('chat-question-answer').nth(index);
    await expect(row.getByText(question.question, { exact: true })).toBeVisible();
    await expect(row.getByText('Small', { exact: true })).toBeVisible();
  }
  await expect(form(page)).toBeHidden();
  await expect(history.getByRole('radio')).toHaveCount(0);
  await expect(history.getByRole('textbox')).toHaveCount(0);
});
