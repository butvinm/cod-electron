import { test, expect, ids, historyKey, picker, ensureChat, addFolders, openHistory, composer } from './helpers/36-session-store';

// In Zed, cmd-g opens thread history only in the threads sidebar. In an editor it is "select next match".
test('Session history key does nothing while focus is in the editor or the project panel', async ({ cod: { page }, store }) => {
  store.seed(store.folders[0], ids.orchard, 'Orchard planning session', 5);
  await ensureChat(page);
  await addFolders(page);
  await page.getByTestId('project-entry').filter({ hasText: 'notes.txt' }).first().click();
  const editor = page.getByTestId('editor-content');
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press(historyKey);
  await expect(picker(page)).toBeHidden();
  await page.getByTestId('project-panel').focus();
  await page.keyboard.press(historyKey);
  await expect(picker(page)).toBeHidden();
  // From the chat it still opens, and the key closes it again.
  await openHistory(page);
  await page.keyboard.press(historyKey);
  await expect(picker(page)).toBeHidden();
  await expect(composer(page)).toBeFocused();
});
