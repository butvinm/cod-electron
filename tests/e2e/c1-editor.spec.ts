import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { keys, newWorkspaceKey, platform, toPlaywright } from './helpers/zed-keymaps';

const modifier = platform === 'macos' ? 'Meta' : 'Control';
const key = (suffix: string) => `${modifier}+${suffix}`;
const area = (page: Page) => page.getByTestId('workspace-area');
const tabs = (page: Page) => area(page).getByTestId('editor-tab');
const activeTab = (page: Page) => tabs(page).and(page.getByRole('tab', { selected: true }));
const buffer = (page: Page) => area(page).getByTestId('editor-content');
const atPath = (locator: Locator, file: string) => locator.and(locator.page().locator(`[data-path=${JSON.stringify(file)}]`));
const indicator = (page: Page) => activeTab(page).getByTestId('editor-unsaved-indicator');

type Projects = { orchard: string; harbor: string };
const test = base.extend<{ projects: Projects }>({
  projects: [async ({}, use) => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cod-story-5-'));
    const projects = { orchard: path.join(temporary, 'orchard'), harbor: path.join(temporary, 'harbor') };
    const previous = process.env.COD_TEST_PICK_FOLDERS;
    try {
      for (const name of ['orchard', 'harbor'] as const) {
        cpSync(path.join(root, 'tests/fixtures/projects', name), projects[name], { recursive: true });
        cpSync(path.join(root, 'tests/fixtures/projects/editor'), projects[name], { recursive: true });
        execFileSync('git', ['init', '--quiet', '--initial-branch=main', projects[name]]);
      }
      process.env.COD_TEST_PICK_FOLDERS = JSON.stringify([[projects.orchard], [projects.harbor]]);
      await use(projects);
    } finally {
      if (previous === undefined) delete process.env.COD_TEST_PICK_FOLDERS;
      else process.env.COD_TEST_PICK_FOLDERS = previous;
      rmSync(temporary, { recursive: true, force: true });
    }
  }, { auto: true }],
});

async function focusPanel(page: Page) {
  const panel = page.getByTestId('project-panel');
  const focused = await panel.isVisible() && await panel.evaluate(node => node === document.activeElement || node.contains(document.activeElement));
  if (!focused) await page.keyboard.press(key('Shift+e'));
  await expect(panel, 'Prerequisite #4: project panel must be implemented before measuring story #5 failures').toBeVisible();
}

async function addFolder(page: Page, folder: string) {
  await focusPanel(page);
  const add = page.getByTestId('project-panel').getByTestId('project-add-folder');
  await add.focus();
  await page.keyboard.press('Enter');
  const row = atPath(page.getByTestId('project-panel').getByTestId('project-entry'), folder);
  await expect(row).toBeVisible();
  await row.click();
  await page.getByTestId('project-panel').focus();
  await page.keyboard.press('ArrowRight');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

async function openFile(page: Page, file: string) {
  await focusPanel(page);
  const row = atPath(page.getByTestId('project-panel').getByTestId('project-entry'), file);
  await expect(row, 'Prerequisite #4: fixture file must be reachable in the real project panel').toBeVisible();
  // Follow #4's Enter-to-open exception, through normal tree selection.
  await row.click();
  await page.getByTestId('project-panel').focus();
  await page.keyboard.press('Enter');
  await expect(atPath(tabs(page), file), 'Story #5 editor is missing: opening a project file must create an editor tab').toBeVisible();
  await expect(activeTab(page)).toHaveCount(1);
  await expect(activeTab(page)).toHaveAttribute('data-path', file);
  await expect(activeTab(page).getByTestId('editor-tab-label')).toHaveText(path.basename(file));
  await expect(buffer(page), 'Story #5 editor is missing: active tab must display an editable buffer').toBeVisible();
  await buffer(page).focus();
}

const normalized = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n$/, '');
async function expectText(page: Page, text: string) {
  await expect.poll(async () => normalized(await buffer(page).innerText())).toBe(normalized(text));
}

async function replace(page: Page, text: string) {
  await buffer(page).focus();
  await page.keyboard.press(key('a'));
  await page.keyboard.insertText(text);
  await expectText(page, text);
}

async function beginning(page: Page) {
  await page.keyboard.press(key('a'));
  await page.keyboard.press('ArrowLeft');
}

const theme = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/zed-themes/one.json'), 'utf8'));
const dark = theme.themes.find((item: { name: string }) => item.name === 'One Dark').style;
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

test('AC1: seven languages open in editor tabs with pinned One Dark highlighting', async ({ cod, projects }, testInfo) => {
  const { page } = cod;
  await addFolder(page, projects.orchard);
  for (const extension of ['ts', 'js', 'py', 'go', 'rs', 'md', 'json']) {
    const file = path.join(projects.orchard, `sample.${extension}`);
    await openFile(page, file);
    await expectText(page, readFileSync(file, 'utf8'));
    await expect(area(page).getByTestId('editor-surface')).toHaveCSS('background-color', rgb(dark['editor.background']));
    await expect(buffer(page)).toHaveCSS('color', rgb(dark['editor.foreground']));
    await expect(buffer(page)).toHaveCSS('font-family', /Lilex/);
    await expect(buffer(page)).toHaveCSS('font-size', '15px');
    const tokens = buffer(page).getByTestId('editor-syntax-token');
    await expect(tokens.first(), `${extension} must have real highlighted source text`).toBeVisible();
    const colors = new Set<string>();
    for (const token of await tokens.all()) {
      expect((await token.innerText()).trim(), 'Syntax markers must wrap source text').not.toBe('');
      const category = await token.getAttribute('data-syntax-token');
      expect(Object.keys(dark.syntax), `Pinned One Dark syntax category ${category}`).toContain(category);
      const color = dark.syntax[category!].color;
      await expect(token).toHaveCSS('color', rgb(color));
      if (color !== dark['editor.foreground']) colors.add(color);
    }
    expect(colors.size, `${extension} must show different syntax colors, not uniformly colored text`).toBeGreaterThanOrEqual(2);
    if (extension === 'ts') await testInfo.attach('typescript-look-check', { body: await page.screenshot(), contentType: 'image/png' });
  }
});

test('AC2: typing, undo redo, arrow and mouse selection, clipboard, line moves and comments', async ({ cod, projects }) => {
  const { page } = cod;
  await addFolder(page, projects.orchard);
  const file = path.join(projects.orchard, 'scratch.txt');
  const original = readFileSync(file, 'utf8');
  await openFile(page, file);
  await page.keyboard.press(key('a'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('!');
  await expectText(page, original + '!');
  await page.keyboard.press(key('z'));
  await expectText(page, original);
  await page.keyboard.press(key('Shift+z'));
  await expectText(page, original + '!');

  await replace(page, 'alpha beta\ngamma delta');
  await beginning(page);
  for (let index = 0; index < 5; index++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.insertText('ALPHA');
  await expectText(page, 'ALPHA beta\ngamma delta');
  for (let index = 0; index < 5; index++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.insertText('alpha');
  await expectText(page, 'alpha beta\ngamma delta');
  await beginning(page);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.insertText('first\n');
  await expectText(page, 'first\ngamma delta');
  await beginning(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.insertText('top\n');
  await expectText(page, 'top\ngamma delta');
  await page.keyboard.press(key('a'));
  await page.keyboard.press(key('x'));
  await expectText(page, '');
  await page.keyboard.press(key('v'));
  await expectText(page, 'top\ngamma delta');
  await page.keyboard.press(key('a'));
  await page.keyboard.press(key('c'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press(key('v'));
  await expectText(page, 'top\ngamma delta\ntop\ngamma delta');

  await replace(page, 'alpha beta\ngamma delta');
  // Read rendered text geometry, then select with the real mouse.
  const point = await buffer(page).evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const start = text.textContent?.indexOf('alpha') ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 5);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    throw new Error('Visible alpha word is missing from the editor buffer');
  });
  await page.mouse.dblclick(point.x, point.y);
  await page.keyboard.insertText('mouse');
  await expectText(page, 'mouse beta\ngamma delta');
  await replace(page, 'first\nsecond');
  await beginning(page);
  await page.keyboard.press('Alt+ArrowDown');
  await expectText(page, 'second\nfirst');
  await page.keyboard.press('Alt+ArrowUp');
  await expectText(page, 'first\nsecond');

  await openFile(page, path.join(projects.orchard, 'sample.ts'));
  await replace(page, 'const orchard = 42;');
  await beginning(page);
  await page.keyboard.press(key('/'));
  await expectText(page, '// const orchard = 42;');
  await page.keyboard.press(key('/'));
  await expectText(page, 'const orchard = 42;');
});

test('AC3: modified tab indicator clears only after save writes the real file', async ({ cod, projects }) => {
  const { page } = cod;
  const file = path.join(projects.orchard, 'scratch.txt');
  const original = readFileSync(file, 'utf8');
  await addFolder(page, projects.orchard);
  await openFile(page, file);
  await expect(indicator(page)).toBeHidden();
  await replace(page, 'Saved invented orchard note.');
  await expect(indicator(page)).toBeVisible();
  await expect(indicator(page)).toHaveCSS('width', '6px');
  await expect(indicator(page)).toHaveCSS('height', '6px');
  await expect(indicator(page)).toHaveCSS('background-color', rgb(dark['text.accent']));
  for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) {
    await expect.poll(() => indicator(page).evaluate((node, property) => parseFloat(getComputedStyle(node)[property]), corner), {
      message: 'All corners of the 6px dirty indicator must be rounded into a circle',
    }).toBeGreaterThanOrEqual(3);
  }
  const dotBox = await indicator(page).boundingBox();
  const labelBox = await activeTab(page).getByTestId('editor-tab-label').boundingBox();
  expect(dotBox, 'Dirty dot must have visible geometry').not.toBeNull();
  expect(labelBox, 'Tab label must have visible geometry').not.toBeNull();
  expect(dotBox!.x + dotBox!.width, 'Dirty dot must occupy the start slot left of the label').toBeLessThanOrEqual(labelBox!.x);
  expect(readFileSync(file, 'utf8')).toBe(original);
  await page.keyboard.press(key('s'));
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('Saved invented orchard note.');
  await expect(indicator(page)).toBeHidden();
  await expectText(page, 'Saved invented orchard note.');
});

const promptButtons = ['Save', "Don't Save", 'Cancel'];
const savePrompt = (page: Page) => page.getByTestId('editor-save-prompt');

async function expectHighlighted(page: Page, action: string) {
  const prompt = savePrompt(page);
  const selected = prompt.getByRole('button', { name: action, exact: true });
  await expect(selected, `${action} must be the highlighted prompt choice`).toHaveAttribute('data-highlighted', 'true');
  for (const name of promptButtons.filter(name => name !== action)) {
    const other = prompt.getByRole('button', { name, exact: true });
    await expect(other).not.toHaveAttribute('data-highlighted', 'true');
    await expect.poll(async () => {
      const selectedColor = await selected.evaluate(node => getComputedStyle(node).backgroundColor);
      const otherColor = await other.evaluate(node => getComputedStyle(node).backgroundColor);
      return selectedColor !== otherColor;
    }, { message: 'Highlighted choice must have a visibly different background' }).toBe(true);
  }
}

async function expectSavePrompt(page: Page, relativePath: string) {
  const prompt = savePrompt(page);
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(`${relativePath} contains unsaved edits. Do you want to save it?`);
  const buttons = prompt.getByRole('button');
  await expect(buttons).toHaveText(promptButtons);
  let previousBottom: number | undefined;
  for (const name of promptButtons) {
    const button = prompt.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box, `${name} must have visible geometry`).not.toBeNull();
    if (previousBottom !== undefined) expect(box!.y, "Prompt buttons must be stacked Save, Don't Save, Cancel").toBeGreaterThanOrEqual(previousBottom);
    previousBottom = box!.y + box!.height;
  }
  await expectHighlighted(page, 'Save');
}

async function confirmPrompt(page: Page) {
  await page.keyboard.press('Enter');
  await expect(savePrompt(page)).toBeHidden();
}

test('AC4: repeated open focuses one tab and close prompt supports cancel discard save by keyboard', async ({ cod, projects }) => {
  const { page } = cod;
  const first = path.join(projects.orchard, 'scratch.txt');
  const second = path.join(projects.orchard, 'sample.ts');
  const third = path.join(projects.orchard, 'sample.js');
  const original = readFileSync(first, 'utf8');
  await addFolder(page, projects.orchard);
  await openFile(page, first);
  // PM exception: project-panel opens are normal tabs, even before any edit.
  await openFile(page, second);
  await expect(tabs(page)).toHaveCount(2);
  await openFile(page, third);
  await expect(tabs(page)).toHaveCount(3);
  await openFile(page, first);
  await openFile(page, third);
  await page.keyboard.press(key('w'));
  await expect(atPath(tabs(page), third)).toHaveCount(0);
  await expect(activeTab(page), 'Closing third must restore first from history, not its neighbour second').toHaveAttribute('data-path', first);
  await expect(savePrompt(page)).toBeHidden();
  await replace(page, 'Keep this draft.');
  await page.keyboard.press(key('s'));
  await expect.poll(() => readFileSync(first, 'utf8')).toBe('Keep this draft.');
  await openFile(page, second);
  await expect(tabs(page)).toHaveCount(2);
  await openFile(page, first);
  await expect(tabs(page)).toHaveCount(2);
  await expect(atPath(tabs(page), first)).toHaveCount(1);
  await expectText(page, 'Keep this draft.');
  await page.keyboard.press(key('w'));
  await expect(atPath(tabs(page), first)).toHaveCount(0);
  await expect(activeTab(page)).toHaveAttribute('data-path', second);
  await expect(page.getByTestId('editor-save-prompt')).toBeHidden();

  await openFile(page, first);
  await replace(page, 'Unsaved private-to-test draft.');
  await page.keyboard.press(key('w'));
  await expectSavePrompt(page, 'scratch.txt');
  await page.keyboard.press('ArrowUp');
  await expectHighlighted(page, 'Cancel');
  await page.keyboard.press('ArrowDown');
  await expectHighlighted(page, 'Save');
  await page.keyboard.press('Tab');
  await expectHighlighted(page, "Don't Save");
  await page.keyboard.press('Tab');
  await expectHighlighted(page, 'Cancel');
  await page.keyboard.press('Tab');
  await expectHighlighted(page, 'Save');
  await page.keyboard.press('Shift+Tab');
  await expectHighlighted(page, 'Cancel');
  await confirmPrompt(page);
  await expect(activeTab(page)).toHaveAttribute('data-path', first);
  await expectText(page, 'Unsaved private-to-test draft.');
  await expect(indicator(page)).toBeVisible();
  expect(readFileSync(first, 'utf8')).toBe('Keep this draft.');
  await page.keyboard.press(key('w'));
  await expectSavePrompt(page, 'scratch.txt');
  await page.keyboard.press('ArrowDown');
  await expectHighlighted(page, "Don't Save");
  await page.keyboard.press('Escape');
  await expect(savePrompt(page)).toBeHidden();
  await expect(activeTab(page)).toHaveAttribute('data-path', first);
  await expectText(page, 'Unsaved private-to-test draft.');
  await expect(indicator(page)).toBeVisible();
  expect(readFileSync(first, 'utf8')).toBe('Keep this draft.');
  await page.keyboard.press(key('w'));
  await expectSavePrompt(page, 'scratch.txt');
  await page.keyboard.press('ArrowDown');
  await expectHighlighted(page, "Don't Save");
  await confirmPrompt(page);
  await expect(atPath(tabs(page), first)).toHaveCount(0);
  expect(readFileSync(first, 'utf8')).toBe('Keep this draft.');
  await openFile(page, first);
  await expectText(page, 'Keep this draft.');
  await expect(indicator(page)).toBeHidden();
  await replace(page, original);
  await page.keyboard.press(key('w'));
  await expectSavePrompt(page, 'scratch.txt');
  await confirmPrompt(page);
  await expect(atPath(tabs(page), first)).toHaveCount(0);
  await expect.poll(() => readFileSync(first, 'utf8')).toBe(original);
  await openFile(page, first);
  await expectText(page, original);
  await expect(indicator(page)).toBeHidden();
});

test('AC5: each workspace restores its tabs active file and unsaved edits', async ({ cod, projects }) => {
  const { page } = cod;
  await addFolder(page, projects.orchard);
  const orchard = path.join(projects.orchard, 'scratch.txt');
  const orchardSecond = path.join(projects.orchard, 'sample.ts');
  const orchardOriginal = readFileSync(orchard, 'utf8');
  await openFile(page, orchardSecond);
  await replace(page, 'const orchard = 42;');
  await openFile(page, orchard);
  await replace(page, 'Orchard unsaved draft.');
  await expect(tabs(page)).toHaveCount(2);
  await page.keyboard.press(newWorkspaceKey);
  await expect(tabs(page)).toHaveCount(0);
  await addFolder(page, projects.harbor);
  const harbor = path.join(projects.harbor, 'scratch.txt');
  const harborOriginal = readFileSync(harbor, 'utf8');
  await openFile(page, harbor);
  await replace(page, 'Harbor unsaved draft.');
  for (let round = 0; round < 2; round++) {
    await page.keyboard.press(toPlaywright(keys.previous));
    await expect(tabs(page)).toHaveCount(2);
    await expect(atPath(tabs(page), harbor)).toHaveCount(0);
    await expect(activeTab(page)).toHaveAttribute('data-path', orchard);
    await expectText(page, 'Orchard unsaved draft.');
    await expect(indicator(page)).toBeVisible();
    await atPath(tabs(page), orchardSecond).click();
    await expectText(page, 'const orchard = 42;');
    await expect(indicator(page)).toBeVisible();
    await atPath(tabs(page), orchard).click();
    await page.keyboard.press(toPlaywright(keys.next));
    await expect(tabs(page)).toHaveCount(1);
    await expect(atPath(tabs(page), orchard)).toHaveCount(0);
    await expect(activeTab(page)).toHaveAttribute('data-path', harbor);
    await expectText(page, 'Harbor unsaved draft.');
    await expect(indicator(page)).toBeVisible();
  }
  expect(readFileSync(orchard, 'utf8')).toBe(orchardOriginal);
  expect(readFileSync(harbor, 'utf8')).toBe(harborOriginal);
});
