import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, homedir, binary, streamingFlags, ids, storeFile, chat, composer, picker, options, ensureChat, openHistory, selectSession, addFolders, send, modifier } from './helpers/36-session-store';

const users = (page: Page) => chat(page).getByTestId('chat-user-message');
const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');
const titles = (page: Page) => options(page).getByTestId('claude-session-title');

test('AC1: session history lists workspace sessions newest first with first-message titles, ages and typing filter', async ({ cod: { page }, store }, testInfo) => {
  store.seed(homedir(), ids.home, 'Home planning session', 6);
  store.seed(store.folders[0], ids.orchard, 'Orchard planning session', 5);
  store.seed(store.folders[1], ids.harbor, 'Harbor planning session', 2);
  store.seed(store.directory, ids.unrelated, 'Unrelated session must stay hidden', 1);
  await page.clock.install({ time: new Date() });
  await ensureChat(page);
  await openHistory(page);
  await expect(titles(page)).toHaveText(['Home planning session']);
  await expect(options(page).getByTestId('claude-session-age')).toHaveText(/6\s*(?:days?|d)\b/i);
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await addFolders(page);
  await composer(page).focus();
  const button = chat(page).getByRole('button', { name: 'Claude session history', exact: true });
  await expect(button, 'Story #36 needs a session history button in the chat header').toBeVisible();
  await button.click();
  await expect(picker(page)).toBeVisible();
  await expect(titles(page)).toHaveText(['Harbor planning session', 'Orchard planning session']);
  await expect(options(page).getByTestId('claude-session-age')).toHaveText([/2\s*(?:days?|d)\b/i, /5\s*(?:days?|d)\b/i]);
  await expect(picker(page).getByRole('textbox', { name: 'Filter Claude sessions' })).toBeFocused();
  await page.keyboard.insertText('OrChArD');
  await expect(titles(page)).toHaveText(['Orchard planning session']);
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await expect(titles(page)).toHaveText(['Harbor planning session', 'Orchard planning session']);
  await testInfo.attach('session-picker-look-check', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await openHistory(page);
  await expect(titles(page)).toHaveText(['Harbor planning session', 'Orchard planning session']);
});

test('AC2: choosing a CLI session replaces the chat with past user messages, assistant replies and live-style tool calls', async ({ cod: { page }, store }) => {
  store.seed(homedir(), ids.home, 'Saved notes session', 2, true);
  await ensureChat(page);
  await send(page, 'Start in Cod');
  await expect(replies(page).last()).toHaveText('Started in Cod.');
  await selectSession(page, 'Saved notes session');
  await expect(users(page)).toHaveText(['Saved notes session', 'Read the saved notes']);
  await expect(replies(page)).toHaveText(['Old assistant reply.', 'Read complete.']);
  await expect(chat(page).getByTestId('chat-session-id')).toHaveText(ids.home);
  await expect(chat(page).getByRole('log', { name: 'Conversation' }).getByTestId(/^(chat-user-message|chat-assistant-message|chat-tool-call)$/)).toHaveCount(5);
  const order = await chat(page).getByRole('log', { name: 'Conversation' }).getByTestId(/^(chat-user-message|chat-assistant-message|chat-tool-call)$/).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
  expect(order).toEqual(['chat-user-message', 'chat-assistant-message', 'chat-user-message', 'chat-tool-call', 'chat-assistant-message']);
  const tools = chat(page).getByTestId('chat-tool-call');
  const saved = tools.first();
  const savedSummary = saved.getByRole('button', { name: /Read.*notes\.txt/ });
  await expect(savedSummary).toHaveAttribute('aria-expanded', 'false');
  await expect(saved.getByTestId('chat-tool-output')).toBeHidden();
  await savedSummary.focus();
  await page.keyboard.press('Enter');
  await expect(savedSummary).toHaveAttribute('aria-expanded', 'true');
  await expect(saved.getByTestId('chat-tool-input')).toContainText('notes.txt');
  await expect(saved.getByTestId('chat-tool-output')).toHaveText('Invented fixture contents.');
  await page.keyboard.press('Enter');
  await send(page, 'Read notes.txt live');
  await expect(tools).toHaveCount(2);
  await expect(replies(page)).toHaveCount(3);
  const liveSummary = tools.last().getByRole('button', { name: /Read.*notes\.txt/ });
  await expect(liveSummary).toHaveAttribute('aria-expanded', 'false');
  await liveSummary.focus();
  await page.keyboard.press('Enter');
  await expect(tools.last().getByTestId('chat-tool-input')).toContainText('notes.txt');
  await expect(tools.last().getByTestId('chat-tool-output')).toHaveText('Invented fixture contents.');
  await expect(replies(page).last()).toHaveText('Read complete.');
  await expect(replies(page).first()).toHaveAttribute('data-state', 'complete');
});

test('AC3: continuing an imported session starts Claude with its resume ID in its own folder after old history', async ({ cod: { page }, store }) => {
  store.seed(store.folders[1], ids.harbor, 'Harbor continuation session', 2);
  await ensureChat(page);
  await addFolders(page);
  await selectSession(page, 'Harbor continuation session');
  expect(store.records().filter(record => record.kind === 'start'), 'Opening history must not start Claude').toHaveLength(0);
  await send(page, 'Continue from the saved conversation');
  await expect(users(page)).toHaveText(['Harbor continuation session', 'Read the saved notes', 'Continue from the saved conversation']);
  await expect(replies(page)).toHaveText(['Old assistant reply.', 'Read complete.', 'Continued in Cod.']);
  await expect(chat(page).getByTestId('chat-session-id')).toHaveText(ids.harbor);
  await expect(chat(page).getByTestId('chat-working-directory')).toContainText(store.folders[1]);
  await expect.poll(() => store.records().filter(record => record.kind === 'start')).toHaveLength(1);
  const start = store.records().find(record => record.kind === 'start')!;
  const index = start.argv!.indexOf('--resume');
  expect(index).toBeGreaterThanOrEqual(0);
  expect(start.argv!.slice(index, index + 2)).toEqual(['--resume', ids.harbor]);
  expect(start.cwd).toBe(store.folders[1]);
  expect(store.records().filter(record => record.kind === 'stdin').map(record => JSON.parse(record.line!).message.content)).toEqual(['Continue from the saved conversation']);
});

test('AC4: reopening a Cod session includes turns persisted by a separate terminal Claude process', async ({ cod: { page }, store }) => {
  await ensureChat(page);
  await send(page, 'Start in Cod');
  await expect(replies(page)).toHaveText(['Started in Cod.']);
  const session = (await chat(page).getByTestId('chat-session-id').innerText()).trim();
  expect(session).toMatch(/^[a-f0-9-]{36}$/i);
  // Load once before terminal continuation so a cached transcript cannot pass.
  await selectSession(page, 'Start in Cod');
  await expect(users(page)).toHaveText(['Start in Cod']);
  const codPid = store.records().find(record => record.kind === 'start')!.pid;
  await expect.poll(() => {
    try { process.kill(codPid, 0); return false; } catch { return true; }
  }, { message: 'Replacing the chat must stop its previous CLI before terminal continuation' }).toBe(true);
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, [...streamingFlags, '--resume', session], { cwd: homedir(), env: { ...process.env, CLAUDE_CONFIG_DIR: store.config } });
    let stdout = ''; let stderr = '';
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Story #36 fixture terminal timed out')); }, 5_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.on('close', code => { clearTimeout(deadline); if (code === 0) resolve(stdout); else reject(new Error(`Fixture terminal exited ${code}: ${stderr}`)); });
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue in terminal' } }) + '\n');
  });
  expect(output.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'result')).toMatchObject({ session_id: session, result: 'Terminal continuation saved.', is_error: false });
  const persisted = readFileSync(storeFile(store.config, homedir(), session), 'utf8');
  expect(persisted).toContain('Continue in terminal');
  expect(persisted).toContain('Terminal continuation saved.');
  const starts = store.records().filter(record => record.kind === 'start');
  expect(starts).toHaveLength(2);
  expect(starts[1].pid).not.toBe(starts[0].pid);
  await selectSession(page, 'Start in Cod');
  await expect(users(page)).toHaveText(['Start in Cod', 'Continue in terminal']);
  await expect(replies(page)).toHaveText(['Started in Cod.', 'Terminal continuation saved.']);
  await expect(chat(page).getByTestId('chat-session-id')).toHaveText(session);
  expect(store.records().filter(record => record.kind === 'start')).toHaveLength(2);
});

test('AC5: a workspace without matching sessions shows the exact empty-state message', async ({ cod: { page }, store }) => {
  store.seed(store.directory, ids.unrelated, 'Session outside this workspace', 1);
  await ensureChat(page);
  await openHistory(page);
  await expect(options(page)).toHaveCount(0);
  await expect(picker(page).getByText('No Claude sessions for this workspace', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await addFolders(page);
  await openHistory(page);
  await expect(options(page)).toHaveCount(0);
  await expect(picker(page).getByText('No Claude sessions for this workspace', { exact: true })).toBeVisible();
});
