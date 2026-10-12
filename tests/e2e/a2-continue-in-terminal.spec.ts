import { test, expect, button, chat, composer, copyCommand, idleSession, prepareChat, processAlive, replies, requireButton, send } from './helpers/continue-in-terminal';

test('AC1: keyboard copies the terminal resume command from the chat header and briefly shows Copied', async ({ cod: { page }, terminalFake: fake, terminalClipboard: clipboard }) => {
  await prepareChat(page, fake.folder);
  const session = await idleSession(page);
  await clipboard.seed('story-35-clipboard-before-copy');
  await copyCommand(page);
  const copied = chat(page).getByTestId('chat-header').getByText('Copied', { exact: true });
  await expect(copied).toBeVisible();
  await expect.poll(clipboard.read).toBe(`cd '${fake.folder}' && claude --resume ${session}`);
  await expect(copied, 'Copied feedback must clear briefly after copying').toBeHidden({ timeout: 5_000 });
  await expect(button(page)).toBeVisible();
  await expect(composer(page)).toHaveValue('');
});

test('AC2: copying from an idle chat ends its Claude process and the fake logs its exit', async ({ cod: { page }, terminalFake: fake, terminalClipboard: clipboard }) => {
  await prepareChat(page, fake.folder);
  const session = await idleSession(page);
  const starts = fake.records().filter(record => record.kind === 'start');
  expect(starts).toHaveLength(1);
  expect(processAlive(starts[0].pid), 'Idle Claude must still be alive before handoff').toBe(true);
  await copyCommand(page);
  await expect.poll(clipboard.read).toBe(`cd '${fake.folder}' && claude --resume ${session}`);
  await expect.poll(() => fake.records().some(record => record.kind === 'exit' && record.pid === starts[0].pid && record.session_id === session), {
    message: 'Copying the command must end the idle Claude process and produce its exit log',
  }).toBe(true);
  await expect.poll(() => processAlive(starts[0].pid), { message: 'The handed-off Claude process must be gone' }).toBe(false);
  expect(fake.records().filter(record => record.kind === 'start')).toHaveLength(1);
  expect(fake.records().filter(record => record.kind === 'turn')).toHaveLength(1);
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  await expect(chat(page).getByTestId('chat-session-id')).toHaveText(session);
});

test('AC3: sending after handoff starts Claude again with the same resume id in the same folder', async ({ cod: { page }, terminalFake: fake, terminalClipboard: clipboard }) => {
  await prepareChat(page, fake.folder);
  const session = await idleSession(page);
  const original = fake.records().find(record => record.kind === 'start')!;
  await copyCommand(page);
  await expect.poll(clipboard.read).toBe(`cd '${fake.folder}' && claude --resume ${session}`);
  await expect.poll(() => fake.records().some(record => record.kind === 'exit' && record.pid === original.pid)).toBe(true);
  await expect.poll(() => processAlive(original.pid)).toBe(false);
  await send(page, 'Continue in Cod after the terminal handoff');
  await expect(replies(page)).toHaveCount(2);
  await expect(replies(page).last()).toContainText('I remember the first message.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  await expect(chat(page).getByTestId('chat-session-id')).toHaveText(session);
  const starts = fake.records().filter(record => record.kind === 'start');
  expect(starts).toHaveLength(2);
  expect(starts[1].pid).not.toBe(original.pid);
  expect(starts.map(record => record.cwd)).toEqual([fake.folder, fake.folder]);
  const argv = starts[1].argv!;
  expect(argv).toContain('--resume');
  expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 2)).toEqual(['--resume', session]);
  const turns = fake.records().filter(record => record.kind === 'turn');
  expect(turns.map(record => record.session_id)).toEqual([session, session]);
  expect(turns[1].history).toEqual(['Remember the first message', 'Continue in Cod after the terminal handoff']);
});

test.describe('working turn', () => {
  test.use({ terminalScenario: 'stream' });

  test('AC4: a working chat disables Continue in Terminal and its tooltip says to wait or interrupt first', async ({ cod: { page }, terminalFake: fake, terminalClipboard: clipboard }) => {
    await prepareChat(page, fake.folder);
    await clipboard.seed('story-35-working-clipboard');
    await send(page, 'Start a gated reply');
    await expect(replies(page).last()).toContainText('First fragment');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'streaming');
    await expect(chat(page).getByTestId('chat-session-id')).toHaveText(/^[0-9a-f-]{36}$/i);
    await expect.poll(() => fake.records().some(record => record.kind === 'gate' && record.name === 'finish')).toBe(true);
    await requireButton(page);
    await expect(button(page)).toBeDisabled();
    await expect(button(page)).toHaveAttribute('title', /wait.*interrupt|interrupt.*wait/i);
    const start = fake.records().find(record => record.kind === 'start')!;
    expect(processAlive(start.pid)).toBe(true);
    expect(fake.records().filter(record => record.kind === 'exit')).toHaveLength(0);
    expect(await clipboard.read()).toBe('story-35-working-clipboard');
    fake.release();
    await expect(replies(page).last()).toContainText('First fragment and final fragment.');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
    await expect(button(page)).toBeEnabled();
  });
});
