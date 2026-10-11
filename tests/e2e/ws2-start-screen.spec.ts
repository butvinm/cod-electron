import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root } from './helpers/electron';
import { keys, newWorkspaceKey, toPlaywright } from './helpers/zed-keymaps';

const mac = process.platform === 'darwin';
const modifier = mac ? 'Meta' : 'Control';
const addFolderKey = `${modifier}+Shift+a`;
const openRecentKey = `Alt+${modifier}+o`;
const newChatKey = `${modifier}+n`;
async function openFolder(page: Page) {
  if (mac) await page.keyboard.press('Meta+o');
  else {
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+o');
  }
}
const start = (page: Page) => page.getByTestId('workspace-area').getByTestId('start-screen');
const recent = (page: Page) => start(page).getByRole('list', { name: 'Recent', exact: true });
const recentPaths = (page: Page) => recent(page).getByTestId('recent-folder');
const panel = (page: Page) => page.getByTestId('project-panel');
const roots = (page: Page) => panel(page).getByTestId('project-root');
const tabs = (page: Page) => page.getByTestId('workspace-tab');
const selectedTab = (page: Page) => tabs(page).and(page.getByRole('tab', { selected: true }));
const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
async function requireStart(page: Page) {
  await expect(start(page), 'Story #29 start screen is missing: an empty workspace must show quick actions').toBeVisible();
}
async function expectRoots(page: Page, folders: string[]) {
  await expect(panel(page)).toBeVisible();
  await expect(roots(page)).toHaveCount(folders.length);
  for (const [index, folder] of folders.entries()) await expect(roots(page).nth(index)).toHaveAttribute('data-path', folder);
}

type Harness = { folders: string[]; launch: (picks?: string[][]) => Promise<{ app: ElectronApplication; page: Page }> };
// Local lifecycle fixture: AC3 restarts real Electron with the same isolated user data.
// No renderer state or recent-store files are injected by the test.
const test = base.extend<{ harness: Harness }>({
  harness: async ({}, use, testInfo) => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-29-')));
    const profile = path.join(directory, 'profile');
    mkdirSync(profile);
    const folders = ['orchard', 'harbor', 'meadow', 'quarry', 'summit', 'willow'].map(name => path.join(directory, name));
    for (const folder of folders) {
      mkdirSync(folder);
      writeFileSync(path.join(folder, 'notes.txt'), `Invented ${path.basename(folder)} project.\n`);
      execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
    }
    let app: ElectronApplication | undefined;
    let page: Page | undefined;
    let run = 0;
    try {
      await use({ folders, launch: async (picks = folders.map(folder => [folder])) => {
        if (app) { await app.close(); app = undefined; }
        const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
        delete env.ELECTRON_RUN_AS_NODE;
        for (const name of Object.keys(env)) if (/^(?:ANTHROPIC|CLAUDE)_.*(?:KEY|TOKEN|SECRET)$/i.test(name)) delete env[name];
        app = await _electron.launch({
          args: [root, `--user-data-dir=${profile}`], cwd: root,
          env: { ...env, COD_USER_DATA_DIR: profile, COD_TEST_PICK_FOLDERS: JSON.stringify(picks), COD_CLAUDE_BIN: path.join(root, 'tests/fakes/claude/claude'), COD_FAKE_CLAUDE_SCENARIO: 'reply', COD_FAKE_CLAUDE_LOG: path.join(directory, 'claude.jsonl') },
          timeout: 15_000, recordVideo: { dir: testInfo.outputPath(`run-${++run}`) },
        });
        page = await app.firstWindow();
        await page.waitForLoadState('load');
        await expect(tabs(page)).toHaveCount(1);
        return { app, page };
      } });
    } finally {
      try {
        if (page && !page.isClosed() && testInfo.status !== testInfo.expectedStatus) await testInfo.attach('window', { body: await page.screenshot(), contentType: 'image/png' });
      } finally {
        try { await app?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
      }
    }
  },
});

test('AC1: empty workspace shows Get Started shortcuts and at most five recent folders', async ({ harness }, testInfo) => {
  const { page } = await harness.launch();
  await requireStart(page);
  await expect(chat(page)).toBeHidden();
  const actions = start(page).getByRole('list', { name: 'Get Started', exact: true });
  await expect(actions.getByRole('listitem')).toHaveCount(3);
  for (const [name, binding] of [
    ['Open Folder', mac ? 'Cmd-O' : 'Ctrl-K Ctrl-O'],
    ['Open Recent', mac ? 'Alt-Cmd-O' : 'Alt-Ctrl-O'],
    ['New Claude Chat', mac ? 'Cmd-N' : 'Ctrl-N'],
  ]) {
    const action = actions.getByRole('button', { name, exact: true });
    await expect(action).toBeVisible();
    await expect(action.getByTestId('start-action-keybinding')).toHaveText(binding);
  }
  await expect(recent(page)).toBeVisible();
  await expect(recentPaths(page)).toHaveCount(0);
  // Populate through the public folder action, including a sixth entry.
  for (const [index] of harness.folders.entries()) {
    await page.keyboard.press(addFolderKey);
    await expectRoots(page, harness.folders.slice(0, index + 1));
  }
  await page.keyboard.press(newWorkspaceKey);
  await requireStart(page);
  await expect(recentPaths(page)).toHaveCount(5);
  for (const [index, folder] of harness.folders.slice(1).reverse().entries()) {
    await expect(recentPaths(page).nth(index)).toHaveAttribute('data-path', folder);
    await expect(recentPaths(page).nth(index)).toContainText(path.basename(folder));
  }
  await testInfo.attach('start-screen-look-check', { body: await page.screenshot(), contentType: 'image/png' });
});

test('AC2: Open Folder key and click add a folder to the empty workspace and open its panel', async ({ harness }) => {
  const { page } = await harness.launch();
  for (const [index, method] of ['keyboard', 'mouse'].entries()) {
    if (index) await page.keyboard.press(newWorkspaceKey);
    await requireStart(page);
    const id = await selectedTab(page).getAttribute('data-workspace-id');
    if (method === 'keyboard') await openFolder(page);
    else await start(page).getByRole('button', { name: 'Open Folder', exact: true }).click();
    await expectRoots(page, [harness.folders[index]]);
    await expect(selectedTab(page)).toHaveAttribute('data-workspace-id', id!);
    await expect(tabs(page)).toHaveCount(index + 1);
  }
});

test('AC3: recent picker persists across restart, sorts and filters, and shortcuts 1 to 5 open entries', async ({ harness }) => {
  test.setTimeout(90_000); // Two real launches and six independent recent activations.
  let { page } = await harness.launch();
  await requireStart(page);
  for (const [index] of harness.folders.entries()) {
    await page.keyboard.press(addFolderKey);
    await expectRoots(page, harness.folders.slice(0, index + 1));
  }
  ({ page } = await harness.launch([]));
  await requireStart(page);
  await page.keyboard.press(`${modifier}+Shift+e`);
  await expectRoots(page, []); // Only recents persist; workspaces do not.
  await page.keyboard.press(openRecentKey);
  const picker = page.getByRole('dialog', { name: 'Open Recent', exact: true });
  await expect(picker, 'Story #29 recent-folder picker must open from the keyboard').toBeVisible();
  const options = picker.getByRole('option');
  const order = [...harness.folders].reverse();
  await expect(options).toHaveCount(6);
  for (const [index, folder] of order.entries()) await expect(options.nth(index)).toHaveAttribute('data-path', folder);
  const query = picker.getByRole('textbox', { name: 'Search recent folders', exact: true });
  await expect(query).toBeFocused();
  await page.keyboard.type('quarry');
  await expect(options).toHaveCount(1);
  await expect(options).toHaveAttribute('data-path', harness.folders[3]);
  const id = await selectedTab(page).getAttribute('data-workspace-id');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expectRoots(page, [harness.folders[3]]);
  await expect(selectedTab(page)).toHaveAttribute('data-workspace-id', id!);
  await expect(tabs(page)).toHaveCount(1);
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press(newWorkspaceKey);
    await requireStart(page);
    // Prior recent activations may reorder the list. Use the currently displayed entry.
    const target = recentPaths(page).nth(index);
    await expect(target).toBeVisible();
    const folder = await target.getAttribute('data-path');
    expect(folder).toBeTruthy();
    const emptyId = await selectedTab(page).getAttribute('data-workspace-id');
    await page.keyboard.press(`${modifier}+${index + 1}`);
    await expectRoots(page, [folder!]);
    await expect(selectedTab(page)).toHaveAttribute('data-workspace-id', emptyId!);
    await expect(tabs(page)).toHaveCount(index + 2);
  }
});

test('AC4: New Claude Chat key and click open the chat with its composer focused', async ({ harness }) => {
  const { page } = await harness.launch([]);
  for (const [index, method] of ['keyboard', 'mouse'].entries()) {
    if (index) await page.keyboard.press(newWorkspaceKey);
    await requireStart(page);
    const id = await selectedTab(page).getAttribute('data-workspace-id');
    if (method === 'keyboard') await page.keyboard.press(newChatKey);
    else await start(page).getByRole('button', { name: 'New Claude Chat', exact: true }).click();
    await expect(chat(page)).toBeVisible();
    await expect(chat(page)).toHaveAttribute('data-workspace-id', id!);
    await expect(chat(page).getByRole('textbox', { name: 'Message Claude' })).toBeFocused();
    await expect(start(page)).toBeHidden();
    await expect(tabs(page)).toHaveCount(index + 1);
  }
});

test('AC5: project panel has no Add Folder button and Add Folder to Project key adds another root', async ({ harness }) => {
  const { page } = await harness.launch();
  await page.keyboard.press(`${modifier}+Shift+e`);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /add folder/i }), 'Story #29 removes the Add Folder button from the project panel').toHaveCount(0);
  await expect(panel(page).getByTestId('project-add-folder')).toHaveCount(0);
  await openFolder(page);
  await expectRoots(page, [harness.folders[0]]);
  const id = await selectedTab(page).getAttribute('data-workspace-id');
  await page.keyboard.press(addFolderKey);
  await expectRoots(page, harness.folders.slice(0, 2));
  await expect(selectedTab(page)).toHaveAttribute('data-workspace-id', id!);
  await expect(tabs(page)).toHaveCount(1);
  await expect(panel(page).getByRole('button', { name: /add folder/i })).toHaveCount(0);
});

test('AC6: Open Folder in a populated workspace creates a new workspace tab with that folder', async ({ harness }) => {
  const { page, app } = await harness.launch();
  await requireStart(page);
  await openFolder(page);
  await expectRoots(page, [harness.folders[0]]);
  const originalId = await selectedTab(page).getAttribute('data-workspace-id');
  await openFolder(page);
  await expect(tabs(page), 'Story #29 Open Folder in a populated workspace must create a new workspace tab').toHaveCount(2);
  await expect(selectedTab(page)).not.toHaveAttribute('data-workspace-id', originalId!);
  await expectRoots(page, [harness.folders[1]]);
  await page.keyboard.press(toPlaywright(keys.previous));
  await expect(selectedTab(page)).toHaveAttribute('data-workspace-id', originalId!);
  await expectRoots(page, [harness.folders[0]]);
  expect(app.windows(), 'Cod uses workspace tabs as Zed windows').toHaveLength(1);
});
