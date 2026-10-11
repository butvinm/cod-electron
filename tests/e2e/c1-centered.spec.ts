import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { keys, newWorkspaceKey, toPlaywright } from './helpers/zed-keymaps';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const key = (suffix: string) => `${modifier}+${suffix}`;
const closePath = readFileSync(path.join(root, 'tests/fixtures/zed-centered/close.svg'), 'utf8').match(/<path d="([^"]+)"/)![1];

const test = base.extend<{ project: string }>({
  project: [async ({}, use) => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cod-story-38-'));
    const project = path.join(temporary, 'orchard');
    const previous = process.env.COD_TEST_PICK_FOLDERS;
    try {
      cpSync(path.join(root, 'tests/fixtures/projects/orchard'), project, { recursive: true });
      execFileSync('git', ['init', '--quiet', '--initial-branch=main', project]);
      process.env.COD_TEST_PICK_FOLDERS = JSON.stringify([[project]]);
      await use(project);
    } finally {
      if (previous === undefined) delete process.env.COD_TEST_PICK_FOLDERS;
      else process.env.COD_TEST_PICK_FOLDERS = previous;
      rmSync(temporary, { recursive: true, force: true });
    }
  }, { auto: true }],
});

async function prepare(page: Page, project: string) {
  await page.keyboard.press(newWorkspaceKey);
  await expect(page.getByTestId('workspace-tab')).toHaveCount(2);
  await page.keyboard.press(key('Shift+e'));
  const panel = page.getByTestId('project-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('project-add-folder').focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByTestId('project-root')).toHaveCount(1);
  await expect(panel.getByTestId('project-root')).toHaveAttribute('data-path', project);
  // Use the real finder keyboard path to open two files, leaving one active tab.
  for (const name of ['file2.txt', 'file10.txt']) {
    await page.keyboard.press(key('p'));
    const finder = page.getByRole('dialog', { name: 'File finder' });
    await expect(finder).toBeVisible();
    await page.keyboard.type(name);
    const rows = finder.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId('file-finder-name')).toHaveText(name);
    await page.keyboard.press('Enter');
    await expect(finder).toBeHidden();
    await expect(page.getByTestId('editor-tab').and(page.getByRole('tab', { selected: true }))).toHaveAttribute('data-path', path.join(project, name));
  }
  await expect(page.getByTestId('editor-tab')).toHaveCount(2);
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds, 'Visible element must have measurable bounds').not.toBeNull();
  expect(bounds!.width).toBeGreaterThan(0);
  expect(bounds!.height).toBeGreaterThan(0);
  return bounds!;
}

async function centered(inner: Locator, outer: Locator, axis: 'x' | 'y', description: string) {
  const a = await box(inner);
  const b = await box(outer);
  const size = axis === 'x' ? 'width' : 'height';
  const delta = Math.abs(a[axis] + a[size] / 2 - b[axis] - b[size] / 2);
  expect.soft(delta, `${description}: center offset on ${axis} must be <= 1 CSS px (measured ${delta})`).toBeLessThanOrEqual(1);
}

async function checkTabs(page: Page, check: (tab: Locator, button: Locator, label: string) => Promise<void>) {
  for (const kind of ['workspace', 'editor'] as const) {
    const tabs = page.getByTestId(`${kind}-tab`);
    await expect(tabs).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      const tab = tabs.nth(index);
      // Measure every tab while active, exposing editor controls by keyboard.
      if (kind === 'workspace') {
        await page.keyboard.press(toPlaywright(index === 0 ? keys.previous : keys.next));
      } else {
        const name = await tab.getByTestId('editor-tab-label').innerText();
        await page.keyboard.press(key('p'));
        const finder = page.getByRole('dialog', { name: 'File finder' });
        await expect(finder).toBeVisible();
        await page.keyboard.type(name);
        await expect(finder.getByRole('option')).toHaveCount(1);
        await page.keyboard.press('Enter');
        await expect(finder).toBeHidden();
      }
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const button = tab.getByRole('button', { name: /^Close / });
      await expect(button).toBeVisible();
      await check(tab, button, `${kind} tab ${index + 1}`);
    }
  }
}

test('AC1: workspace and editor tab close icons are X shapes centered vertically within 1 px', async ({ cod, project }) => {
  await prepare(cod.page, project);
  await checkTabs(cod.page, async (tab, button, label) => {
    // Hook belongs to the drawn SVG path, not an empty icon wrapper.
    const icon = button.getByTestId('tab-close-icon');
    await expect(icon, `${label}: replace the text multiplication sign with a measurable X icon`).toBeVisible();
    expect(await icon.evaluate(node => node.tagName.toLowerCase()), `${label}: X must be a drawn SVG path`).toBe('path');
    await expect(icon).toHaveAttribute('d', closePath);
    const painted = await icon.evaluate(node => {
      const style = getComputedStyle(node);
      return style.stroke !== 'none' && Number.parseFloat(style.strokeWidth) > 0 && Number(style.strokeOpacity) > 0;
    });
    expect(painted, `${label}: X path must have a visible stroke`).toBe(true);
    await centered(icon, tab, 'y', `${label} X in tab`);
  });
});

test('AC2: each tab close X is centered horizontally and vertically in its hit area within 1 px', async ({ cod, project }) => {
  await prepare(cod.page, project);
  await checkTabs(cod.page, async (_tab, button, label) => {
    const icon = button.getByTestId('tab-close-icon');
    await expect(icon, `${label}: expose the drawn X for hit area measurements`).toBeVisible();
    await centered(icon, button, 'x', `${label} X in close hit area`);
    await centered(icon, button, 'y', `${label} X in close hit area`);
  });
});

async function showResults(page: Page) {
  await page.keyboard.press(key('p'));
  const finder = page.getByRole('dialog', { name: 'File finder' });
  await expect(finder).toBeVisible();
  await page.keyboard.type('file');
  await expect(finder.getByRole('option')).toHaveCount(2);
  expect((await finder.getByTestId('file-finder-name').allTextContents()).sort()).toEqual(['file10.txt', 'file2.txt']);
  return finder;
}

test('AC3: every finder result filename and path are centered vertically in its row within 1 px', async ({ cod, project }) => {
  await prepare(cod.page, project);
  const finder = await showResults(cod.page);
  // Exercise both the highlighted and unhighlighted row states.
  for (let selection = 0; selection < 2; selection++) {
    const rows = finder.getByRole('option');
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index);
      for (const part of ['name', 'path'] as const) {
        const text = row.getByTestId(`file-finder-${part}`);
        await expect(text).not.toHaveText('');
        await centered(text, row, 'y', `Finder row ${index + 1} ${part}, selection ${selection + 1}`);
      }
    }
    if (selection === 0) {
      await cod.page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    }
  }
});

test('AC4: tabs and finder screenshot comparisons with stock Zed 1.23.2 are available for PR review', async ({ cod, project }, testInfo) => {
  await prepare(cod.page, project);
  await testInfo.attach('cod-tabs', { body: await cod.page.screenshot(), contentType: 'image/png' });
  await showResults(cod.page);
  await testInfo.attach('cod-finder', { body: await cod.page.screenshot(), contentType: 'image/png' });
  testInfo.annotations.push({
    type: 'Manual PR evidence check',
    description: 'Reviewer must inspect both comparisons, confirm stock Zed 1.23.2/default settings and keymap, and confirm the PR embeds or links them. File presence alone cannot establish AC4.',
  });
  for (const subject of ['tabs', 'finder']) {
    const file = path.join(root, 'tests/e2e/evidence/38', `${subject}-next-to-zed.png`);
    const present = existsSync(file);
    expect.soft(present, `AC4: missing ${subject} comparison next to stock Zed 1.23.2: ${file}`).toBe(true);
    if (present) {
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 8).toString('hex'), `${subject} comparison must be a PNG`).toBe('89504e470d0a1a0a');
      expect(bytes.length, `${subject} comparison must contain an IHDR header`).toBeGreaterThan(24);
      expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
      expect(bytes.readUInt32BE(16), `${subject} comparison width`).toBeGreaterThan(0);
      expect(bytes.readUInt32BE(20), `${subject} comparison height`).toBeGreaterThan(0);
      await testInfo.attach(`${subject}-next-to-zed-1.23.2`, { path: file, contentType: 'image/png' });
    }
  }
});
