import { test, expect, chat, copyCommand, idleSession, prepareChat, send } from './helpers/continue-in-terminal';

// Story #35 follow-up: after a handoff the chat says the terminal owns the session until the person writes here again.
test('a persistent notice after Continue in Terminal stays until the next message is sent in Cod', async ({ cod: { page }, terminalFake: fake }) => {
  await prepareChat(page, fake.folder);
  await idleSession(page);
  const notice = chat(page).getByTestId('chat-handoff-notice');
  await expect(notice).toBeHidden();
  await copyCommand(page);
  await expect(notice).toHaveText('Continued in terminal. Close it there before you write here.');
  await expect(chat(page).getByTestId('chat-header').getByText('Copied', { exact: true })).toBeHidden({ timeout: 5_000 });
  await expect(notice, 'The notice outlives the Copied feedback').toBeVisible();
  await send(page, 'Back in Cod');
  await expect(notice).toBeHidden();
});
