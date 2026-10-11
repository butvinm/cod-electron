import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { chat, composer, openInitialChat, replies } from './helpers/new-chat';
import { pending, response, form, type Fake } from './helpers/ask-user-question';
import { newWorkspaceKey } from './helpers/zed-keymaps';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const linkURL = 'https://example.invalid/story-54#quoted';
type RecordLine = ReturnType<Fake['records']>[number] & { pid?: number; name?: string };
type Fixture = Omit<Fake, 'records'> & { folders: string[]; records: () => RecordLine[]; release: (name: string) => void };
const scenarios: Record<string, string> = {
  AC2: '54-quoted-reference', AC3: '54-blank-code',
  AC5: '54-stream-then-permission', AC6: 'ask-user-question-keyboard',
};

// The automatic fixture prepares invented projects and fake state before the shared
// Electron fixture launches. No app state is injected into the renderer.
const test = base.extend<{ regression: Fixture }>({
  regression: [async ({}, use, testInfo) => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-54-')));
    const folders = ['orchard', 'harbor'].map(name => path.join(directory, name));
    const config = path.join(directory, 'claude-config');
    const gates = path.join(directory, 'gates');
    const log = path.join(directory, 'claude.jsonl');
    for (const folder of [...folders, config, gates]) mkdirSync(folder);
    for (const folder of folders) {
      writeFileSync(path.join(folder, 'notes.txt'), 'Invented regression fixture.\n');
      execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
    }
    writeFileSync(path.join(config, 'settings.json'), '{}\n');
    const ac = testInfo.title.match(/^AC\d+/)![0];
    const scenario = scenarios[ac] ?? 'reply';
    const requests: Fake['requests'] = ac === 'AC6'
      ? JSON.parse(readFileSync(path.join(root, 'tests/fakes/claude/scenarios', `${scenario}.json`), 'utf8')).turns
        .map((turn: { permission?: Fake['requests'][number] }[]) => turn.find(step => step.permission)!.permission!)
      : [];
    const overrides: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: config,
      COD_CLAUDE_BIN: path.join(root, 'tests/fakes/claude/claude'),
      COD_FAKE_CLAUDE_LOG: log, COD_FAKE_CLAUDE_GATES: gates,
      COD_FAKE_CLAUDE_SCENARIO: scenario,
      COD_TEST_PICK_FOLDERS: JSON.stringify(folders.map(folder => [folder])),
      COD_TEST_RECORD_EXTERNAL_URLS: ac === 'AC2' ? '1' : undefined,
    };
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('COD_') || /^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name)) {
        if (!(name in overrides)) overrides[name] = undefined;
      }
    }
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const records = (): RecordLine[] => existsSync(log)
      ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine) : [];
    try {
      await use({ folders, records, requests, release: name => writeFileSync(path.join(gates, name), 'release') });
    } finally {
      if (existsSync(log)) await testInfo.attach('story-54-fake-log', { body: readFileSync(log), contentType: 'application/x-ndjson' });
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});

const panel = (page: Page) => page.getByTestId('project-panel');
const roots = (page: Page) => panel(page).getByTestId('project-root');
async function openFolder(page: Page) {
  if (process.platform === 'darwin') await page.keyboard.press('Meta+o');
  else { await page.keyboard.press('Control+k'); await page.keyboard.press('Control+o'); }
}
async function send(page: Page, text = 'Show the invented regression fixture') {
  await openInitialChat(page);
  await composer(page).focus();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect(chat(page).getByTestId('chat-user-message').last()).toHaveText(text);
}

test('AC1: reopening A through Open Recent makes A first and Cmd-1 opens A', async ({ cod: { page }, regression: { folders } }) => {
  const [a, b] = folders as [string, string];
  await openFolder(page);
  await expect(roots(page)).toHaveAttribute('data-path', a);
  await page.keyboard.press(`${modifier}+Shift+a`);
  await expect(roots(page)).toHaveCount(2);
  await expect(roots(page).nth(1)).toHaveAttribute('data-path', b);
  const originalWorkspace = await page.getByRole('tab', { selected: true }).getAttribute('data-workspace-id');
  await page.keyboard.press(`Alt+${modifier}+o`);
  const picker = page.getByRole('dialog', { name: 'Open Recent', exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option').first()).toHaveAttribute('data-path', b);
  await expect(picker.getByRole('textbox', { name: 'Search recent folders' })).toBeFocused();
  await page.keyboard.insertText('orchard');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await expect(picker.getByRole('option')).toHaveAttribute('data-path', a);
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-workspace-id', originalWorkspace!);
  await expect(roots(page)).toHaveCount(2);
  await page.keyboard.press(newWorkspaceKey);
  const start = page.getByTestId('workspace-area').getByTestId('start-screen');
  await expect(start).toBeVisible();
  const recent = start.getByRole('list', { name: 'Recent', exact: true }).getByTestId('recent-folder');
  await expect(recent).toHaveCount(2);
  await expect(recent.first(), 'AC1: reopening an existing root must refresh its recent position').toHaveAttribute('data-path', a);
  await expect(recent.last()).toHaveAttribute('data-path', b);
  const emptyWorkspace = await page.getByRole('tab', { selected: true }).getAttribute('data-workspace-id');
  await expect(roots(page)).toHaveCount(0);
  await page.keyboard.press(`${modifier}+1`);
  await expect(roots(page)).toHaveCount(1);
  await expect(roots(page)).toHaveAttribute('data-path', a);
  await expect(roots(page)).toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-workspace-id', emptyWorkspace!);
});

test('AC2: a reference defined inside a blockquote opens in the system browser', async ({ cod: { app, page } }) => {
  await send(page);
  const reply = replies(page).last();
  await expect(reply).toHaveAttribute('data-state', 'complete');
  const link = reply.getByRole('link', { name: 'Read the quoted reference', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', linkURL);
  const originalURL = page.url();
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const navigations: string[] = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await link.click(); // AC2 explicitly asks for a clickable link.
  await expect.poll(() => app.evaluate(() =>
    (globalThis as typeof globalThis & { __codTestOpenedExternalURLs?: string[] }).__codTestOpenedExternalURLs ?? []),
  { message: 'AC2: the reference URL must reach the system-browser handoff' }).toEqual([linkURL]);
  expect(navigations).toEqual([]);
  expect(page.url()).toBe(originalURL);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windows);
});

test('AC3: a fenced code block with one blank body line shows exactly one empty line', async ({ cod: { page } }) => {
  await send(page);
  const reply = replies(page).last();
  await expect(reply).toHaveAttribute('data-state', 'complete');
  const code = reply.locator('pre > code');
  await expect(code).toHaveCount(1);
  // A blank inline code element can have zero width. Its pre paints the code body.
  await expect(reply.locator('pre')).toBeVisible();
  expect(await code.textContent(), 'AC3: preserve one blank line without appending a second newline').toBe('\n');
  const lines = await code.evaluate(element => {
    const pre = element.parentElement!;
    const style = getComputedStyle(pre);
    const contentHeight = pre.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    return contentHeight / parseFloat(style.lineHeight);
  });
  expect(lines, 'AC3: the code body must occupy exactly one painted line').toBeCloseTo(1, 1);
});

test('AC4: closing the only editor tab clears every open-file gray background', async ({ cod: { page }, regression: { folders } }) => {
  await openFolder(page);
  const file = path.join(folders[0]!, 'notes.txt');
  await page.keyboard.press(`${modifier}+p`);
  await expect(page.getByTestId('file-finder')).toBeVisible();
  await page.getByTestId('file-finder-query').focus();
  await page.keyboard.insertText('notes.txt');
  await expect(page.getByTestId('file-finder-result')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-tab')).toHaveCount(1);
  await expect(page.getByTestId('editor-tab')).toHaveAttribute('data-path', file);
  await page.getByTestId('editor-content').focus();
  const theme = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/zed-themes/one.json'), 'utf8'));
  const hex: string = theme.themes.find((entry: { name: string }) => entry.name === 'One Dark').style['element.selected'];
  const gray = `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
  const rows = panel(page).getByRole('treeitem');
  const opened = rows.and(page.locator(`[data-path=${JSON.stringify(file)}]`));
  await expect(opened).toBeVisible();
  await expect(opened).toHaveCSS('background-color', gray);
  await page.keyboard.press(`${modifier}+w`);
  await expect(page.getByTestId('editor-tab')).toHaveCount(0);
  await expect(opened).toBeVisible();
  await expect.poll(() => rows.evaluateAll((elements, color) =>
    elements.filter(element => getComputedStyle(element).backgroundColor === color).length, gray),
  { message: 'AC4: no project row may retain the open-file gray after Cmd-W' }).toBe(0);
});

test('AC5: Escape closes the permission mode menu without interrupting a reply or changing a prompt', async ({ cod: { page }, regression }) => {
  const selector = chat(page).getByTestId('chat-permission-mode');
  const menu = chat(page).getByRole('menu', { name: 'Permission mode', exact: true });
  async function dismissMenu() {
    await selector.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Manual', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(selector).toBeFocused();
    await expect(selector).toHaveText('Manual');
    await expect(chat(page).getByTestId('chat-interrupted')).toHaveCount(0);
    expect(regression.records().filter(record => record.kind === 'signal')).toHaveLength(0);
  }
  await send(page);
  await expect(replies(page).last()).toContainText('First fragment');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'streaming');
  await expect.poll(() => regression.records().filter(record => record.kind === 'gate').map(record => record.name)).toContain('finish');
  const pid = regression.records().find(record => record.kind === 'start')!.pid;
  await dismissMenu();
  await expect(replies(page).last()).toHaveAttribute('data-state', 'streaming');
  regression.release('finish');
  await expect(replies(page).last()).toHaveText('First fragment and final fragment.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');

  await send(page, 'Request the invented command permission');
  const prompt = chat(page).getByTestId('chat-permission-prompt');
  await expect(prompt).toBeVisible();
  const promptText = await prompt.innerText();
  await expect(prompt.getByRole('button', { name: 'Allow once', exact: true })).toBeFocused();
  expect(regression.records().filter(record => record.kind === 'permission-request')).toHaveLength(1);
  await dismissMenu();
  await expect(prompt).toBeVisible();
  expect(await prompt.innerText()).toBe(promptText);
  for (const name of ['Allow once', 'Allow for this session', 'Deny']) await expect(prompt.getByRole('button', { name, exact: true })).toBeEnabled();
  expect(regression.records().filter(record => record.kind === 'permission-answer')).toHaveLength(0);
  await prompt.getByRole('button', { name: 'Allow once', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => regression.records().filter(record => record.kind === 'permission-answer')[0]?.answer?.behavior).toBe('allow');
  await expect(replies(page).last()).toHaveText('Allowed command complete.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  expect(regression.records().filter(record => record.kind === 'signal')).toHaveLength(0);
  expect(regression.records().filter(record => record.kind === 'start').map(record => record.pid)).toEqual([pid]);
});

test('AC6: declining a question with Escape leaves a collapsed Declined history line', async ({ cod: { page }, regression }) => {
  await pending(page, regression);
  await page.keyboard.press('Escape');
  expect((await response(regression)).answer).toEqual({ behavior: 'deny', message: 'The user declined to answer' });
  await expect(replies(page).last()).toContainText('Question declined: The user declined to answer. Continuing the fixture.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  await expect(form(page)).toBeHidden();
  const history = chat(page).getByTestId('chat-question-history');
  await expect(history, 'AC6: declined questions must remain in chat history').toHaveCount(1);
  await expect(history).toBeVisible();
  await expect(history.getByRole('button', { name: 'Declined', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(history.getByRole('radio')).toHaveCount(0);
  await expect(history.getByRole('textbox')).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
  expect(regression.records().filter(record => record.kind === 'signal')).toHaveLength(0);
});
