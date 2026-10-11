import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const panel = (page: Page) => page.getByTestId('project-panel');
const entry = (page: Page, file: string) => panel(page).getByRole('treeitem').and(page.locator(`[data-path=${JSON.stringify(file)}]`));
const tab = (page: Page, file: string) => page.getByTestId('editor-tab').and(page.locator(`[data-path=${JSON.stringify(file)}]`));
const reference = path.join(root, 'tests/fixtures/zed-project-panel');
const theme = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/zed-themes/one.json'), 'utf8')).themes.find((theme: { name: string }) => theme.name === 'One Dark').style as Record<string, string>;
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
const gray = rgb(theme['element.selected']!);
const blue = rgb(theme['border.focused']!);
const files = ['sample.ts', 'sample.json', 'sample.md', 'sample.rs', 'sample.py', 'sample.unknown-cod37'];
const icons = ['file-code', 'file-braces', 'book-open', 'file-code', 'file-code', 'file'];

const test = base.extend<{ project: string }>({
  project: [async ({}, use) => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cod-story-37-'));
    const project = path.join(temporary, 'panel-look');
    const previous = process.env.COD_TEST_PICK_FOLDERS;
    try {
      mkdirSync(path.join(project, 'branches', 'nested'), { recursive: true });
      for (const file of files) writeFileSync(path.join(project, file), file.endsWith('.json') ? '{}\n' : '// Invented panel fixture.\n');
      for (let index = 0; index < 90; index++) writeFileSync(path.join(project, 'branches', 'nested', `item-${String(index).padStart(3, '0')}.ts`), '// Invented reveal fixture.\n');
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

async function setup(page: Page, project: string) {
  await page.keyboard.press(`${modifier}+Shift+e`);
  await expect(panel(page)).toBeVisible();
  const oldButton = panel(page).getByTestId('project-add-folder');
  if (await oldButton.isVisible()) {
    await oldButton.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.press(`${modifier}+Shift+a`);
  }
  await expect(entry(page, project)).toBeVisible();
  await panel(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(entry(page, project)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(entry(page, project)).toHaveAttribute('aria-expanded', 'true');
}

async function select(page: Page, file: string) {
  await panel(page).focus();
  await page.keyboard.press('Home');
  // Bounded real keyboard navigation, without assigning selection through JS.
  const count = await panel(page).getByRole('treeitem').count();
  for (let index = 0; index <= count; index++) {
    if (await entry(page, file).getAttribute('aria-selected') === 'true') return;
    await page.keyboard.press('ArrowDown');
  }
  await expect(entry(page, file), 'Fixture prerequisite: keyboard navigation reaches the requested row').toHaveAttribute('aria-selected', 'true');
}

async function open(page: Page, file: string) {
  await select(page, file);
  await page.keyboard.press('Enter'); // Existing story #4 exception: Enter opens files.
  await expect(tab(page, file)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('editor-content').focus();
}

async function expectIcon(row: Locator, name: string) {
  const icon = row.getByTestId('project-entry-icon');
  await expect(icon, `AC1: every row must render Lucide's ${name} icon`).toBeVisible();
  const svg = readFileSync(path.join(reference, `${name}.svg`), 'utf8');
  await expect.poll(() => icon.evaluate(async (node, expected) => {
    const normalize = (element: Element) => Array.from(element.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')).map(shape => ({
      tag: shape.tagName.toLowerCase(),
      attributes: Array.from(shape.attributes).filter(attribute => !['fill', 'stroke', 'class', 'style'].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]).sort(),
    }));
    let rendered: Element = node;
    if (node instanceof HTMLImageElement) {
      if (!node.complete || node.naturalWidth === 0) return false;
      rendered = new DOMParser().parseFromString(await (await fetch(node.src)).text(), 'image/svg+xml').documentElement;
    }
    const upstream = new DOMParser().parseFromString(expected, 'image/svg+xml').documentElement;
    const shapes = normalize(rendered);
    return shapes.length > 0 && JSON.stringify(shapes) === JSON.stringify(normalize(upstream));
  }, svg), `AC1: rendered ${name} geometry must match the pinned Lucide icon`).toBe(true);
}

async function expectFrame(row: Locator, focused: boolean) {
  await expect.poll(() => row.evaluate((node, color) => {
    const style = getComputedStyle(node);
    const visible = (width: string, kind: string, paint: string) => parseFloat(width) > 0 && kind !== 'none' && kind !== 'hidden' && paint === color;
    const border = ['Top', 'Right', 'Bottom', 'Left'].every(side => visible(style.getPropertyValue(`border-${side.toLowerCase()}-width`), style.getPropertyValue(`border-${side.toLowerCase()}-style`), style.getPropertyValue(`border-${side.toLowerCase()}-color`)));
    return border || visible(style.outlineWidth, style.outlineStyle, style.outlineColor) || style.boxShadow.includes(color);
  }, blue), focused ? 'AC3: selected row must have a border.focused frame' : 'AC2: editor-focused row must have no focus frame').toBe(focused);
}

test('AC1: rows use Zed file-type mapping with Lucide icons and closed or open folder icons', async ({ cod: { page }, project }) => {
  await setup(page, project);
  await expectIcon(entry(page, project), 'folder-open');
  const folder = path.join(project, 'branches');
  await expectIcon(entry(page, folder), 'folder');
  await select(page, folder);
  await page.keyboard.press('ArrowRight');
  await expect(entry(page, folder)).toHaveAttribute('aria-expanded', 'true');
  await expectIcon(entry(page, folder), 'folder-open');
  await page.keyboard.press('ArrowLeft');
  await expect(entry(page, folder)).toHaveAttribute('aria-expanded', 'false');
  await expectIcon(entry(page, folder), 'folder');
  for (const [index, file] of files.entries()) await expectIcon(entry(page, path.join(project, file)), icons[index]!);
  await expect(panel(page).getByTestId('project-entry-icon')).toHaveCount(await panel(page).getByRole('treeitem').count());
});

test('AC2: active editor file keeps One Dark gray background without a frame', async ({ cod: { page }, project }) => {
  await setup(page, project);
  const first = path.join(project, 'sample.ts');
  const second = path.join(project, 'sample.json');
  await open(page, first);
  await expect(entry(page, first), 'AC2: active editor file must use One Dark element.selected').toHaveCSS('background-color', gray);
  await expectFrame(entry(page, first), false);
  await open(page, second);
  await expect(entry(page, second)).toHaveCSS('background-color', gray);
  await expectFrame(entry(page, second), false);
  await expect(entry(page, first)).not.toHaveCSS('background-color', gray);
});

test('AC3: Up and Down frame selection blue while the open file stays gray', async ({ cod: { page }, project }) => {
  await setup(page, project);
  const opened = path.join(project, 'sample.json');
  await open(page, opened);
  await panel(page).focus();
  await expectFrame(entry(page, opened), true);
  await expect(entry(page, opened)).toHaveCSS('background-color', gray);
  await page.keyboard.press('ArrowDown');
  const next = panel(page).getByRole('treeitem', { selected: true });
  await expect(next).not.toHaveAttribute('data-path', opened);
  await expectFrame(next, true);
  await expectFrame(entry(page, opened), false);
  await expect(entry(page, opened), 'AC3: moving selection must preserve the open file highlight').toHaveCSS('background-color', gray);
  await expect(tab(page, opened)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(entry(page, opened)).toHaveAttribute('aria-selected', 'true');
  await expectFrame(entry(page, opened), true);
  await expect(entry(page, opened)).toHaveCSS('background-color', gray);
  await page.getByTestId('editor-content').focus();
  await expectFrame(entry(page, opened), false);
});

test('AC4: switching to a deep open tab expands parents and scrolls its gray row into view', async ({ cod: { page }, project }) => {
  await setup(page, project);
  const branch = path.join(project, 'branches');
  const nested = path.join(branch, 'nested');
  const deep = path.join(nested, 'item-089.ts');
  for (const folder of [branch, nested]) {
    await select(page, folder);
    await page.keyboard.press('ArrowRight');
    await expect(entry(page, folder)).toHaveAttribute('aria-expanded', 'true');
  }
  await open(page, deep);
  await open(page, path.join(project, 'sample.ts'));
  await select(page, branch);
  await page.keyboard.press('ArrowLeft');
  await expect(entry(page, branch)).toHaveAttribute('aria-expanded', 'false');
  await expect(entry(page, deep)).toBeHidden();
  await page.keyboard.press('Home');
  // The existing finder activates an already-open tab through the keyboard.
  await page.keyboard.press(`${modifier}+p`);
  await expect(page.getByTestId('file-finder')).toBeVisible();
  await page.getByTestId('file-finder-query').focus();
  await page.keyboard.insertText('item-089.ts');
  await expect(page.getByTestId('file-finder-result').and(page.locator(`[data-path=${JSON.stringify(deep)}]`))).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(tab(page, deep)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, deep)).toHaveCount(1);
  for (const folder of [project, branch, nested]) {
    await expect(entry(page, folder), 'AC4: switching editor tabs must expand every collapsed parent').toHaveAttribute('aria-expanded', 'true');
  }
  await expect(entry(page, deep)).toBeVisible();
  await expect(entry(page, deep)).toHaveCSS('background-color', gray);
  // Inspect geometry without locator actions that would scroll the row for the app.
  await expect.poll(() => entry(page, deep).evaluate(node => {
    const row = node.getBoundingClientRect();
    let top = 0;
    let bottom = innerHeight;
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) {
        const box = ancestor.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    return row.height > 0 && row.top >= top && row.bottom <= bottom;
  }), 'AC4: the app must scroll the entire revealed file row into the panel viewport').toBe(true);
});
