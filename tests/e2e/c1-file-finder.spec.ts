import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { newWorkspaceKey } from './helpers/zed-keymaps';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const finder = (page: Page) => page.getByTestId('file-finder');
const input = (page: Page) => finder(page).getByTestId('file-finder-query');
const results = (page: Page) => finder(page).getByTestId('file-finder-result');
const result = (page: Page, file: string) => results(page).and(page.locator(`[data-path=${JSON.stringify(file)}]`));
const selected = (page: Page) => results(page).and(page.getByRole('option', { selected: true }));

type Projects = { folders: string[]; orchard: string; harbor: string; requestLog: string; target: string };
type Options = { fixtureKind: 'projects' | 'ignored' | 'large' };

const test = base.extend<Options & { projects: Projects }>({
  fixtureKind: ['projects', { option: true }],
  // This runs before the inherited Electron fixture. Only dialog responses are faked.
  projects: [async ({ fixtureKind }, use) => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cod-story-6-'));
    const orchard = path.join(temporary, 'orchard');
    const harbor = path.join(temporary, 'harbor');
    const generated = path.join(temporary, 'generated');
    const requestLog = path.join(temporary, 'open-requests.jsonl');
    const previousPicker = process.env.COD_TEST_PICK_FOLDERS;
    const previousLog = process.env.COD_TEST_OPEN_REQUEST_LOG_PATH;
    try {
      let folders: string[];
      if (fixtureKind === 'projects') {
        for (const name of ['orchard', 'harbor']) {
          cpSync(path.join(root, 'tests/fixtures/projects', name), path.join(temporary, name), { recursive: true });
        }
        folders = [orchard, harbor];
      } else {
        mkdirSync(generated);
        folders = [generated];
        if (fixtureKind === 'ignored') {
          mkdirSync(path.join(generated, 'cache'));
          writeFileSync(path.join(generated, '.gitignore'), 'ignored-marker.txt\ncache/*\n!cache/keep-marker.txt\n');
          for (const file of ['visible-marker.txt', 'ignored-marker.txt', 'cache/nested-marker.txt', 'cache/keep-marker.txt']) {
            writeFileSync(path.join(generated, file), 'Invented finder fixture.\n');
          }
        } else {
          // Exactly 20,000 project files; .git metadata is not part of this count.
          for (let index = 0; index < 19_999; index++) {
            writeFileSync(path.join(generated, `document-${String(index).padStart(5, '0')}.txt`), 'Invented performance fixture.\n');
          }
          writeFileSync(path.join(generated, 'q-performance-target.txt'), 'First query result.\n');
        }
      }
      for (const folder of folders) execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
      if (fixtureKind === 'ignored') writeFileSync(path.join(generated, '.git/hidden-marker.txt'), 'Must not appear.\n');
      process.env.COD_TEST_PICK_FOLDERS = JSON.stringify([folders]);
      process.env.COD_TEST_OPEN_REQUEST_LOG_PATH = requestLog;
      await use({ folders, orchard, harbor, requestLog, target: path.join(generated, 'q-performance-target.txt') });
    } finally {
      if (previousPicker === undefined) delete process.env.COD_TEST_PICK_FOLDERS;
      else process.env.COD_TEST_PICK_FOLDERS = previousPicker;
      if (previousLog === undefined) delete process.env.COD_TEST_OPEN_REQUEST_LOG_PATH;
      else process.env.COD_TEST_OPEN_REQUEST_LOG_PATH = previousLog;
      rmSync(temporary, { recursive: true, force: true });
    }
  }, { auto: true }],
});

async function openFinder(page: Page) {
  await page.keyboard.press(`${modifier}+p`);
  await expect(finder(page), 'Story #6 file finder is missing: Cmd+P/Ctrl+P must show the real finder').toBeVisible();
  await expect(input(page)).toBeFocused();
}

async function prepareWorkspace(page: Page, projects: Projects) {
  // Check the feature first, so the red baseline identifies #6 rather than #4.
  await openFinder(page);
  await page.keyboard.press('Escape');
  await expect(finder(page)).toBeHidden();
  await page.keyboard.press(`${modifier}+Shift+e`);
  const panel = page.getByTestId('project-panel');
  await expect(panel, 'Prerequisite: story #4 project panel must support adding roots').toBeVisible();
  const add = panel.getByTestId('project-add-folder');
  await add.focus();
  await page.keyboard.press('Enter');
  for (const folder of projects.folders) {
    await expect(panel.getByTestId('project-root').and(page.locator(`[data-path=${JSON.stringify(folder)}]`))).toBeVisible();
  }
  await expect(panel.getByTestId('project-root')).toHaveCount(projects.folders.length);
}

async function query(page: Page, text: string) {
  await input(page).press(`${modifier}+a`);
  await page.keyboard.type(text);
  await expect(input(page)).toHaveValue(text);
}

function requests(log: string): Array<{ path: string; workspaceId: string }> {
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

test('AC1: Cmd+P opens the finder and Escape restores the previous focus', async ({ cod, projects }) => {
  const { page } = cod;
  const tab = page.getByTestId('workspace-tab').and(page.getByRole('tab', { selected: true }));
  await expect(tab).toBeFocused();
  await openFinder(page);
  await page.keyboard.press('Escape');
  await expect(finder(page)).toBeHidden();
  await expect(tab).toBeFocused();
  await prepareWorkspace(page, projects);
  const previousFocus = page.getByTestId('project-panel').getByTestId('project-add-folder');
  await previousFocus.focus();
  await openFinder(page);
  await page.keyboard.press('Escape');
  await expect(finder(page)).toBeHidden();
  await expect(previousFocus).toBeFocused();
});

test('AC2: fuzzy path matches span active roots with names, relative paths and highlights', async ({ cod, projects }, testInfo) => {
  const { page } = cod;
  await prepareWorkspace(page, projects);
  await openFinder(page);
  await query(page, 'fst');
  for (const [folder, relative] of [[projects.orchard, 'alpha/first.txt'], [projects.harbor, 'notes/first.txt']]) {
    const row = result(page, path.join(folder, relative));
    await expect(row).toBeVisible();
    await expect(row.getByTestId('file-finder-name')).toHaveText('first.txt');
    await expect(row.getByTestId('file-finder-path')).toHaveText(relative);
    const matches = row.getByTestId('file-finder-match');
    await expect.poll(async () => (await matches.allTextContents()).join('').toLowerCase()).toBe('fst');
    const highlighted = await matches.evaluateAll(nodes => nodes.length > 0 && nodes.every(node => {
      const style = getComputedStyle(node);
      const parent = getComputedStyle(node.parentElement!);
      return style.color !== parent.color || style.backgroundColor !== parent.backgroundColor || style.fontWeight !== parent.fontWeight || style.textDecorationLine !== parent.textDecorationLine;
    }));
    expect(highlighted, 'Every matched character must have visible emphasis').toBe(true);
  }
  await testInfo.attach('file-finder-two-root-look-check', { body: await page.screenshot(), contentType: 'image/png' });
  await query(page, 'afst');
  await expect(result(page, path.join(projects.orchard, 'alpha/first.txt'))).toBeVisible();
  await expect(result(page, path.join(projects.harbor, 'notes/first.txt'))).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press(newWorkspaceKey);
  await openFinder(page);
  await query(page, 'fst');
  await expect(results(page)).toHaveCount(0);
});

test('AC3: Up/Down select results and Enter or a click dispatches the chosen file', async ({ cod, projects }) => {
  const { page } = cod;
  await prepareWorkspace(page, projects);
  const workspaceId = await page.getByTestId('workspace-area').getAttribute('data-workspace-id');
  await openFinder(page);
  await query(page, 'fst');
  await expect(results(page)).toHaveCount(2);
  for (const file of [path.join(projects.orchard, 'alpha/first.txt'), path.join(projects.harbor, 'notes/first.txt')]) {
    await expect(result(page, file)).toBeVisible();
  }
  await expect(selected(page)).toHaveCount(1);
  await expect(results(page).first()).toHaveAttribute('aria-selected', 'true');
  const first = await selected(page).getAttribute('data-path');
  expect(first).toBeTruthy();
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toHaveCount(1);
  const second = await selected(page).getAttribute('data-path');
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowUp');
  await expect(selected(page)).toHaveAttribute('data-path', first!);
  expect(requests(projects.requestLog), 'Navigation must not open files').toEqual([]);
  await page.keyboard.press('Enter');
  await expect.poll(() => requests(projects.requestLog)).toEqual([{ path: first, workspaceId }]);
  await expect(finder(page)).toBeHidden();
  await openFinder(page);
  await query(page, 'fst');
  await result(page, second!).click();
  await expect.poll(() => requests(projects.requestLog)).toEqual([{ path: first, workspaceId }, { path: second, workspaceId }]);
  await expect(finder(page)).toBeHidden();
});

test.describe('Generated ignore fixture', () => {
  test.use({ fixtureKind: 'ignored' });
  test('AC4: .gitignore rules exclude files and directories and .git is never listed', async ({ cod, projects }) => {
    const { page } = cod;
    await prepareWorkspace(page, projects);
    await openFinder(page);
    await query(page, 'marker');
    const folder = projects.folders[0];
    for (const relative of ['visible-marker.txt', 'cache/keep-marker.txt']) {
      await expect(result(page, path.join(folder, relative))).toBeVisible();
    }
    await expect(results(page)).toHaveCount(2);
    for (const relative of ['ignored-marker.txt', 'cache/nested-marker.txt', '.git/hidden-marker.txt']) {
      await expect(result(page, path.join(folder, relative))).toHaveCount(0);
    }
  });
});

test.describe('Generated 20,000-file fixture', () => {
  test.use({ fixtureKind: 'large' });
  test('AC5: first matching results render within 200 ms of a keystroke in 20,000 files', async ({ cod, projects }, testInfo) => {
    const { page } = cod;
    await prepareWorkspace(page, projects);
    await openFinder(page);
    await expect(input(page)).toHaveValue('');
    // Observe the real DOM in the renderer clock; IPC and locator polling are outside the measurement.
    await input(page).evaluate((node, target) => {
      const field = node as HTMLInputElement & { finderLatency?: Promise<number> };
      field.finderLatency = new Promise((resolve, reject) => {
        field.addEventListener('keydown', event => {
          if (event.key !== 'q') { reject(new Error(`Expected q keystroke, received ${event.key}`)); return; }
          const started = performance.now();
          const visible = (element: Element) => {
            const style = getComputedStyle(element);
            return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0;
          };
          const check = () => {
            const dialog = field.closest('[data-testid="file-finder"]')!;
            const rows = Array.from(dialog.querySelectorAll('[data-testid="file-finder-result"]')).filter(visible);
            const row = rows[0];
            if (field.value === 'q' && rows.length === 1 && row.getAttribute('data-path') === target &&
              Array.from(row.querySelectorAll('[data-testid="file-finder-name"], [data-testid="file-finder-path"]')).filter(visible).length === 2) {
              resolve(performance.now() - started);
            } else if (performance.now() - started > 1_000) {
              reject(new Error('No visible q result within 1000 ms after keydown'));
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }, { once: true });
      });
      // The assertion awaits this promise after the keystroke. Keep early rejection handled.
      void field.finderLatency.catch(() => {});
    }, projects.target);
    await page.keyboard.press('q');
    const elapsed = await input(page).evaluate(node => (node as HTMLInputElement & { finderLatency: Promise<number> }).finderLatency);
    await testInfo.attach('finder-latency', { body: JSON.stringify({ files: 20_000, query: 'q', keydownToVisibleFrameMs: elapsed }), contentType: 'application/json' });
    expect(elapsed, 'First matching results must be visible within 200 ms of keydown').toBeLessThanOrEqual(200);
    await expect(result(page, projects.target)).toBeVisible();
  });
});
