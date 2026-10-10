import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { newWorkspaceKey, keys, toPlaywright } from './helpers/zed-keymaps';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const focusKey = `${modifier}+Shift+e`;
const toggleKey = `${modifier}+b`;
const panel = (page: Page) => page.getByTestId('project-panel');
const rows = (page: Page) => panel(page).getByTestId('project-entry');
const roots = (page: Page) => panel(page).getByTestId('project-root');
const names = (page: Page) => rows(page).getByTestId('project-entry-label');
const selected = (page: Page) => rows(page).and(page.getByRole('treeitem', { selected: true }));
const entry = (page: Page, absolutePath: string) => rows(page).and(page.locator(`[data-path=${JSON.stringify(absolutePath)}]`));

type Projects = { orchard: string; harbor: string; requestLog: string };
// Automatic fixtures finish setup before the inherited cod fixture launches Electron.
// Each native picker invocation consumes one array; the third also tests multi-select.
const test = base.extend<{ projects: Projects }>({
  projects: [async ({}, use) => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cod-story-4-'));
    const projects = { orchard: path.join(temporary, 'orchard'), harbor: path.join(temporary, 'harbor'), requestLog: path.join(temporary, 'open-requests.jsonl') };
    const previous = process.env.COD_TEST_PICK_FOLDERS;
    const previousLog = process.env.COD_TEST_OPEN_REQUEST_LOG_PATH;
    try {
      for (const name of ['orchard', 'harbor'] as const) {
        cpSync(path.join(root, 'tests/fixtures/projects', name), projects[name], { recursive: true });
        execFileSync('git', ['init', '--quiet', '--initial-branch=main', projects[name]]);
      }
      process.env.COD_TEST_PICK_FOLDERS = JSON.stringify([[projects.orchard], [projects.harbor], [projects.orchard, projects.harbor]]);
      process.env.COD_TEST_OPEN_REQUEST_LOG_PATH = projects.requestLog;
      await use(projects);
    } finally {
      if (previous === undefined) delete process.env.COD_TEST_PICK_FOLDERS;
      else process.env.COD_TEST_PICK_FOLDERS = previous;
      if (previousLog === undefined) delete process.env.COD_TEST_OPEN_REQUEST_LOG_PATH;
      else process.env.COD_TEST_OPEN_REQUEST_LOG_PATH = previousLog;
      rmSync(temporary, { recursive: true, force: true });
    }
  }, { auto: true }],
});

async function showPanel(page: Page) {
  await expect(page.getByTestId('cod-window')).toBeVisible();
  await page.keyboard.press(focusKey);
  await expect(panel(page), 'Story #4 project panel is missing: the focus key must show the real project panel').toBeVisible();
}

async function addFolder(page: Page, folder: string) {
  await panel(page).getByTestId('project-add-folder').click();
  await expect(roots(page).and(page.locator(`[data-path=${JSON.stringify(folder)}]`))).toHaveCount(1);
  await expect(entry(page, folder)).toBeVisible();
}

async function expand(page: Page, folder: string) {
  await entry(page, folder).click();
  await expect(entry(page, folder)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(entry(page, folder)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(entry(page, folder)).toHaveAttribute('aria-expanded', 'true');
}

async function expectSelected(page: Page, file: string) {
  await expect(selected(page)).toHaveCount(1);
  await expect(entry(page, file)).toHaveAttribute('aria-selected', 'true');
}

function requests(log: string): Array<{ path: string; workspaceId: string }> {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function expectRequest(page: Page, log: string, file: string, count: number) {
  await expect.poll(() => requests(log).length, 'Real open-file dispatch must be recorded once per activation').toBe(count);
  const workspaceId = await page.getByTestId('workspace-tab').and(page.locator('[aria-selected="true"]')).getAttribute('data-workspace-id');
  expect(requests(log).at(-1)).toEqual({ path: file, workspaceId });
}

test('AC1: add-folder picker adds several roots to the active workspace only', async ({ cod, projects }, testInfo) => {
  const { page, app } = cod;
  await showPanel(page);
  await expect(roots(page)).toHaveCount(0);
  await addFolder(page, projects.orchard);
  await addFolder(page, projects.harbor);
  await expect(roots(page)).toHaveCount(2);
  await expand(page, projects.orchard);
  await testInfo.attach('two-root-project-panel-look-check', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press(newWorkspaceKey);
  await showPanel(page);
  await expect(roots(page)).toHaveCount(0);
  // The third picker returns both roots in one invocation.
  await panel(page).getByTestId('project-add-folder').click();
  await expect(roots(page)).toHaveCount(2);
  await expect(entry(page, projects.orchard)).toBeVisible();
  await expect(entry(page, projects.harbor)).toBeVisible();
  expect(app.windows()).toHaveLength(1);
});

test('AC2: panel starts closed and Zed dock and focus keys toggle it', async ({ cod }) => {
  const { page } = cod;
  await expect(page.getByTestId('cod-window')).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await showPanel(page);
  // Focus may live on the panel or on one of its descendants.
  await expect.poll(() => panel(page).evaluate(node => node === document.activeElement || node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press(toggleKey);
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press(toggleKey);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press(toggleKey);
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press(focusKey);
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => panel(page).evaluate(node => node === document.activeElement || node.contains(document.activeElement))).toBe(true);
});

test('AC3: arrows navigate and expand, Enter and mouse open the selected file', async ({ cod, projects }) => {
  const { page } = cod;
  await showPanel(page);
  await addFolder(page, projects.orchard);
  await expand(page, projects.orchard);
  await page.keyboard.press('ArrowDown');
  const alpha = path.join(projects.orchard, 'alpha');
  const first = path.join(alpha, 'first.txt');
  const second = path.join(alpha, 'second.txt');
  await expectSelected(page, alpha);
  await page.keyboard.press('ArrowRight');
  await expect(entry(page, alpha)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, first);
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, second);
  await page.keyboard.press('ArrowUp');
  await expectSelected(page, first);
  expect(requests(projects.requestLog)).toEqual([]); // Moving selection must not emit an open request.
  // Story exception: stock Zed uses Space to open and Enter to rename.
  await page.keyboard.press('Enter');
  await expectRequest(page, projects.requestLog, first, 1);
  await expectSelected(page, first);
  await entry(page, alpha).getByTestId('project-entry-toggle').click();
  await expect(entry(page, alpha)).toHaveAttribute('aria-expanded', 'false');
  await expect(entry(page, first)).toBeHidden();
  await entry(page, alpha).getByTestId('project-entry-toggle').click();
  await expect(entry(page, first)).toBeVisible();
  await entry(page, second).click();
  await expectSelected(page, second);
  await expectRequest(page, projects.requestLog, second, 2);
  await entry(page, alpha).click();
  await page.keyboard.press('ArrowLeft');
  await expect(entry(page, alpha)).toHaveAttribute('aria-expanded', 'false');
  await expect(entry(page, second)).toBeHidden();
});

test('AC4: folders precede naturally sorted files, dotfiles stay visible and .git is hidden', async ({ cod, projects }) => {
  const { page } = cod;
  await showPanel(page);
  await addFolder(page, projects.orchard);
  await expand(page, projects.orchard);
  await expect(names(page)).toHaveText(['orchard', 'alpha', 'Beta', '.env.example', '.gitignore', 'apple.txt', 'file2.txt', 'file10.txt', 'ignored.txt', 'Zebra.txt']);
  await expect(entry(page, path.join(projects.orchard, '.git'))).toHaveCount(0);
  await expect(entry(page, path.join(projects.orchard, '.env.example'))).toBeVisible();
  await expect(entry(page, path.join(projects.orchard, 'ignored.txt'))).toBeVisible();
});

test('AC5: workspace switching restores its own roots, expansion and selection', async ({ cod, projects }) => {
  const { page } = cod;
  await showPanel(page);
  await addFolder(page, projects.orchard);
  await expand(page, projects.orchard);
  const alpha = path.join(projects.orchard, 'alpha');
  await expand(page, alpha);
  await page.keyboard.press('ArrowDown');
  const orchardFile = path.join(alpha, 'first.txt');
  await expectSelected(page, orchardFile);
  await page.keyboard.press(newWorkspaceKey);
  await showPanel(page);
  await expect(roots(page)).toHaveCount(0);
  await addFolder(page, projects.harbor);
  await expand(page, projects.harbor);
  const notes = path.join(projects.harbor, 'notes');
  await expand(page, notes);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const harborFile = path.join(notes, 'second.txt');
  await expectSelected(page, harborFile);
  for (const state of [
    { key: keys.previous, folder: projects.orchard, expanded: alpha, file: orchardFile, absent: projects.harbor },
    { key: keys.next, folder: projects.harbor, expanded: notes, file: harborFile, absent: projects.orchard },
  ]) {
    await page.keyboard.press(toPlaywright(state.key));
    await expect(panel(page)).toBeVisible();
    await expect(roots(page)).toHaveCount(1);
    await expect(entry(page, state.absent)).toHaveCount(0);
    await expect(entry(page, state.folder)).toHaveAttribute('aria-expanded', 'true');
    await expect(entry(page, state.expanded)).toHaveAttribute('aria-expanded', 'true');
    await expect(entry(page, state.file)).toBeVisible();
    await expectSelected(page, state.file);
  }
});
