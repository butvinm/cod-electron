import { accessSync, chmodSync, constants, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { keys, newWorkspaceKey, platform, toPlaywright } from './helpers/zed-keymaps';

const modifier = platform === 'macos' ? 'Meta' : 'Control';
const closeKey = toPlaywright(keys.close);
const area = (page: Page) => page.getByTestId('workspace-area');
const buffer = (page: Page) => area(page).getByTestId('editor-content');
const prompt = (page: Page) => page.getByTestId('editor-save-prompt');
const buttons = ['Save all', 'Discard all', 'Cancel'];
const atPath = (locator: Locator, file: string) => locator.and(locator.page().locator(`[data-path=${JSON.stringify(file)}]`));
const workspace = (page: Page, id: string) => page.getByTestId('workspace-tab').and(page.locator(`[data-workspace-id=${JSON.stringify(id)}]`));
const editorTab = (page: Page, file: string) => atPath(area(page).getByTestId('editor-tab'), file);

type Projects = { orchard: string; harbor: string; temporary: string };
const test = base.extend<{ projects: Projects }>({
  projects: [async ({}, use) => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cod-story-17-'));
    const projects = { temporary, orchard: path.join(temporary, 'orchard'), harbor: path.join(temporary, 'harbor') };
    const previous = process.env.COD_TEST_PICK_FOLDERS;
    try {
      for (const name of ['orchard', 'harbor'] as const) {
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
  if (!focused) await page.keyboard.press(`${modifier}+Shift+e`);
  await expect(panel, 'Prerequisite #4: project panel must be available').toBeVisible();
}

async function addFolder(page: Page, folder: string) {
  await focusPanel(page);
  const panel = page.getByTestId('project-panel');
  await panel.getByTestId('project-add-folder').focus();
  await page.keyboard.press('Enter');
  const row = atPath(panel.getByTestId('project-entry'), folder);
  await expect(row).toBeVisible();
  await row.click();
  await panel.focus();
  await page.keyboard.press('ArrowRight');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const id = await area(page).getAttribute('data-workspace-id');
  expect(id).toBeTruthy();
  return id!;
}

async function openFile(page: Page, file: string) {
  await focusPanel(page);
  const panel = page.getByTestId('project-panel');
  const row = atPath(panel.getByTestId('project-entry'), file);
  await expect(row, 'Prerequisite #4: fixture file must be reachable in the real project panel').toBeVisible();
  // Match c1-editor.spec.ts and story #4's Enter-to-open exception.
  await row.click();
  await panel.focus();
  await page.keyboard.press('Enter');
  await expect(editorTab(page, file), 'Prerequisite #5: real editor tab must open').toHaveAttribute('aria-selected', 'true');
  await expect(area(page).getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(buffer(page)).toBeVisible();
  await buffer(page).focus();
}

async function expectText(page: Page, text: string) {
  await expect.poll(() => buffer(page).locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent ?? '').join('\n'))).toBe(text);
}

async function modify(page: Page, file: string, draft: string) {
  await openFile(page, file);
  await buffer(page).focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.insertText(draft);
  await expectText(page, draft);
  await expect(editorTab(page, file).getByTestId('editor-unsaved-indicator')).toBeVisible();
}

async function expectPrompt(page: Page, files: string[]) {
  const dialog = prompt(page);
  await expect(dialog, 'Story #17 multi-file save prompt is missing: closing or quitting with modified files must ask first').toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'alertdialog');
  await expect(dialog).toContainText('Do you want to save changes to the following files?');
  await expect(dialog.getByTestId('editor-save-prompt-file')).toHaveText(files);
  await expect(dialog.getByRole('button')).toHaveText(buttons);
  for (const name of buttons) await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
  await highlighted(page, 'Save all');
}

async function highlighted(page: Page, name: string) {
  const chosen = prompt(page).getByRole('button', { name, exact: true });
  await expect(chosen).toHaveAttribute('data-highlighted', 'true');
  for (const otherName of buttons.filter(button => button !== name)) {
    const other = prompt(page).getByRole('button', { name: otherName, exact: true });
    await expect(other).not.toHaveAttribute('data-highlighted', 'true');
    await expect.poll(async () => (await chosen.evaluate(node => getComputedStyle(node).backgroundColor)) !== (await other.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(true);
  }
}

async function closed(page: Page, id: string) {
  await expect(prompt(page)).toBeHidden();
  await expect(workspace(page, id), 'The closed workspace identity must disappear, including last-workspace replacement').toHaveCount(0);
  await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
  await expect(area(page)).not.toHaveAttribute('data-workspace-id', id);
}

async function saveCurrent(page: Page, file: string, draft: string) {
  await openFile(page, file);
  await buffer(page).focus();
  await page.keyboard.press(`${modifier}+s`);
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(draft);
  await expect(editorTab(page, file).getByTestId('editor-unsaved-indicator')).toBeHidden();
}

test('AC1: workspace button and shortcut show the multi-file prompt for one or more modified tabs', async ({ cod: { page }, projects }) => {
  const id = await addFolder(page, projects.orchard);
  const first = path.join(projects.orchard, 'scratch.txt');
  const second = path.join(projects.orchard, 'sample.ts');
  const clean = path.join(projects.orchard, 'sample.js');
  await modify(page, first, 'AC1 first draft');
  await workspace(page, id).getByTestId('workspace-close').click();
  await expectPrompt(page, ['scratch.txt']);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toBeHidden();
  await expect(workspace(page, id)).toBeVisible();
  await modify(page, second, 'AC1 second draft');
  await openFile(page, clean);
  await page.keyboard.press(closeKey);
  await expectPrompt(page, ['scratch.txt', 'sample.ts']);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toBeHidden();
  await saveCurrent(page, first, 'AC1 first draft');
  await saveCurrent(page, second, 'AC1 second draft');
});

test('AC2: Save all retains the workspace on a real save error and writes every draft before closing on retry', async ({ cod: { page }, projects }) => {
  const id = await addFolder(page, projects.orchard);
  const first = path.join(projects.orchard, 'scratch.txt');
  const failing = path.join(projects.orchard, 'sample.ts');
  const original = readFileSync(failing, 'utf8');
  await modify(page, first, 'AC2 saved first draft');
  await modify(page, failing, 'AC2 saved second draft');
  // Atomic saves can overwrite a read-only file. A directory at the target fails
  // deterministically even as root; the original bytes are held outside the repo.
  const backup = path.join(projects.temporary, 'original-sample.ts');
  renameSync(failing, backup);
  mkdirSync(failing);
  try {
    await page.keyboard.press(closeKey);
    await expectPrompt(page, ['scratch.txt', 'sample.ts']);
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toBeHidden();
    await expect(workspace(page, id), 'A failed save must keep the original workspace open').toBeVisible();
    await expect(editorTab(page, failing)).toHaveAttribute('aria-selected', 'true');
    await expect(area(page).getByTestId('editor-notice')).toContainText(/Could not save sample\.ts: .+/);
    await expect(editorTab(page, failing).getByTestId('editor-unsaved-indicator')).toBeVisible();
    await expectText(page, 'AC2 saved second draft');
    expect(readFileSync(backup, 'utf8')).toBe(original);
  } finally {
    rmSync(failing, { recursive: true, force: true });
    renameSync(backup, failing);
  }
  await page.keyboard.press(closeKey);
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page)).toContainText('Do you want to save changes to the following files?');
  await highlighted(page, 'Save all');
  await page.keyboard.press('Enter');
  await closed(page, id);
  expect(readFileSync(first, 'utf8')).toBe('AC2 saved first draft');
  expect(readFileSync(failing, 'utf8')).toBe('AC2 saved second draft');
});

test('AC3: Cancel preserves every draft and Discard all closes without writing any file', async ({ cod: { page }, projects }) => {
  const id = await addFolder(page, projects.orchard);
  const files = ['scratch.txt', 'sample.ts'].map(name => path.join(projects.orchard, name));
  const originals = files.map(file => readFileSync(file, 'utf8'));
  for (const [index, file] of files.entries()) await modify(page, file, `AC3 draft ${index}`);
  await page.keyboard.press(closeKey);
  await expectPrompt(page, ['scratch.txt', 'sample.ts']);
  await page.keyboard.press('ArrowUp');
  await highlighted(page, 'Cancel');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toBeHidden();
  await expect(workspace(page, id)).toBeVisible();
  for (const [index, file] of files.entries()) {
    await openFile(page, file);
    await expectText(page, `AC3 draft ${index}`);
    await expect(editorTab(page, file).getByTestId('editor-unsaved-indicator')).toBeVisible();
    expect(readFileSync(file, 'utf8')).toBe(originals[index]);
  }
  await page.keyboard.press(closeKey);
  await expectPrompt(page, ['scratch.txt', 'sample.ts']);
  await page.keyboard.press('ArrowDown');
  await highlighted(page, 'Discard all');
  await page.keyboard.press('Enter');
  await closed(page, id);
  for (const [index, file] of files.entries()) expect(readFileSync(file, 'utf8')).toBe(originals[index]);
  await expect(area(page).getByTestId('editor-tab')).toHaveCount(0);
});

test('AC4: Enter confirms the highlight, Escape cancels, and arrows and Tab navigate with wrapping', async ({ cod: { page }, projects }) => {
  const id = await addFolder(page, projects.orchard);
  const file = path.join(projects.orchard, 'scratch.txt');
  const original = readFileSync(file, 'utf8');
  await modify(page, file, 'AC4 keyboard draft');
  await page.keyboard.press(closeKey);
  await expectPrompt(page, ['scratch.txt']);
  for (const [stroke, name] of [
    ['ArrowUp', 'Cancel'], ['ArrowDown', 'Save all'], ['ArrowDown', 'Discard all'],
    ['ArrowUp', 'Save all'], ['Tab', 'Discard all'], ['Tab', 'Cancel'],
    ['Tab', 'Save all'], ['Shift+Tab', 'Cancel'], ['Shift+Tab', 'Discard all'],
  ]) {
    await page.keyboard.press(stroke);
    await highlighted(page, name);
  }
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toBeHidden();
  await expect(workspace(page, id)).toBeVisible();
  await expectText(page, 'AC4 keyboard draft');
  expect(readFileSync(file, 'utf8')).toBe(original);
  await page.keyboard.press(closeKey);
  await expectPrompt(page, ['scratch.txt']);
  await page.keyboard.press('Enter');
  await closed(page, id);
  expect(readFileSync(file, 'utf8')).toBe('AC4 keyboard draft');
});

test('AC5: app quit prompts for modified files in inactive workspaces and Cancel keeps Cod running', async ({ cod: { page, app }, projects }) => {
  const firstId = await addFolder(page, projects.orchard);
  const first = path.join(projects.orchard, 'scratch.txt');
  const second = path.join(projects.harbor, 'sample.ts');
  const firstOriginal = readFileSync(first, 'utf8');
  const secondOriginal = readFileSync(second, 'utf8');
  await modify(page, first, 'AC5 orchard draft');
  await page.keyboard.press(newWorkspaceKey);
  const secondId = await addFolder(page, projects.harbor);
  await modify(page, second, 'AC5 harbor draft');
  await page.keyboard.press(newWorkspaceKey);
  const cleanId = await area(page).getAttribute('data-workspace-id');
  // Request the real Electron lifecycle, without app.close(), window destruction,
  // state injection or calling a renderer prompt directly. Schedule so evaluate
  // returns before the missing feature can terminate its execution context.
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
  await expectPrompt(page, ['scratch.txt', 'sample.ts']);
  await page.keyboard.press('ArrowUp');
  await highlighted(page, 'Cancel');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toBeHidden();
  expect(page.isClosed(), 'Cancel must keep the app window alive').toBe(false);
  await expect(page.getByTestId('workspace-tab')).toHaveCount(3);
  await expect(area(page)).toHaveAttribute('data-workspace-id', cleanId!);
  for (const [id, file, draft, original] of [
    [firstId, first, 'AC5 orchard draft', firstOriginal],
    [secondId, second, 'AC5 harbor draft', secondOriginal],
  ]) {
    if (id === firstId) {
      await page.keyboard.press(toPlaywright(keys.previous));
      await page.keyboard.press(toPlaywright(keys.previous));
    } else {
      await page.keyboard.press(toPlaywright(keys.next));
    }
    await expect(area(page)).toHaveAttribute('data-workspace-id', id);
    await openFile(page, file);
    await expectText(page, draft);
    await expect(editorTab(page, file).getByTestId('editor-unsaved-indicator')).toBeVisible();
    expect(readFileSync(file, 'utf8')).toBe(original);
    await saveCurrent(page, file, draft);
  }
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('AC5: window close prompts, Cancel keeps the edit, and Discard all exits without writing', async ({ cod: { page, app }, projects }) => {
  const id = await addFolder(page, projects.orchard);
  const file = path.join(projects.orchard, 'scratch.txt');
  const original = readFileSync(file, 'utf8');
  const draft = 'AC5 window close draft';
  await modify(page, file, draft);
  // Use the production BrowserWindow close event, not app.quit() or destroy().
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
  await expectPrompt(page, ['scratch.txt']);
  await page.keyboard.press('ArrowUp');
  await highlighted(page, 'Cancel');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toBeHidden();
  expect(page.isClosed(), 'Cancel must keep the window alive').toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(workspace(page, id)).toBeVisible();
  await expectText(page, draft);
  await expect(editorTab(page, file).getByTestId('editor-unsaved-indicator')).toBeVisible();
  expect(readFileSync(file, 'utf8')).toBe(original);

  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
  await expectPrompt(page, ['scratch.txt']);
  await page.keyboard.press('ArrowDown');
  await highlighted(page, 'Discard all');
  const appProcess = app.process();
  await Promise.all([
    app.waitForEvent('close'),
    page.keyboard.press('Enter').catch(error => {
      // The app can exit before Playwright acknowledges the key press.
      if (!String(error).includes('Target page, context or browser has been closed')) throw error;
    }),
  ]);
  await expect.poll(() => appProcess.exitCode, { message: 'Discard all must exit the app through window close' }).toBe(0);
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(appProcess.signalCode, 'The app must exit normally, without harness force-kill').toBeNull();
  expect(readFileSync(file, 'utf8')).toBe(original);
});

test('AC5: repeated quit requests keep one prompt and Save all quits once after writing every file', async ({ cod: { page, app }, projects }) => {
  await addFolder(page, projects.orchard);
  const files = ['scratch.txt', 'sample.ts'].map(name => path.join(projects.orchard, name));
  const drafts = ['AC5 repeated quit first draft', 'AC5 repeated quit second draft'];
  const originals = files.map(file => readFileSync(file, 'utf8'));
  for (const [index, file] of files.entries()) await modify(page, file, drafts[index]);
  // Observe the public DOM to catch transient duplicate or replacement dialogs too.
  const dialogs = await page.evaluateHandle(() => {
    const state = { added: 0 };
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-testid="editor-save-prompt"]')) state.added++;
        state.added += node.querySelectorAll('[data-testid="editor-save-prompt"]').length;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return state;
  });
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
  await expectPrompt(page, ['scratch.txt', 'sample.ts']);
  const originalPrompt = await prompt(page).elementHandle();
  expect(originalPrompt).not.toBeNull();
  for (let request = 0; request < 3; request++) {
    await app.evaluate(({ app }) => { app.quit(); });
    await expect(prompt(page)).toHaveCount(1);
    await expectPrompt(page, ['scratch.txt', 'sample.ts']);
    expect(await originalPrompt!.evaluate(node => node.isConnected), 'Repeated quit must retain the original prompt').toBe(true);
  }
  expect(await dialogs.evaluate(state => state.added), 'Only one multi-file prompt may be created').toBe(1);
  for (const [index, file] of files.entries()) expect(readFileSync(file, 'utf8')).toBe(originals[index]);

  const exits = { app: 0, window: 0, process: 0, willQuit: 0 };
  app.on('console', message => {
    if (message.text() === 'cod-story-17-will-quit') exits.willQuit++;
  });
  await app.evaluate(({ app }) => {
    app.on('will-quit', () => console.log('cod-story-17-will-quit'));
  });
  app.on('close', () => exits.app++);
  page.on('close', () => exits.window++);
  const appProcess = app.process();
  appProcess.on('exit', () => exits.process++);
  await Promise.all([
    app.waitForEvent('close'),
    page.keyboard.press('Enter').catch(error => {
      // The app can exit before Playwright acknowledges the key press.
      if (!String(error).includes('Target page, context or browser has been closed')) throw error;
    }),
  ]);
  await expect.poll(() => appProcess.exitCode, { message: 'Save all must finish writing and exit after repeated quit requests' }).toBe(0);
  await expect.poll(() => exits).toEqual({ app: 1, window: 1, process: 1, willQuit: 1 });
  expect(page.isClosed()).toBe(true);
  expect(appProcess.signalCode).toBeNull();
  for (const [index, file] of files.entries()) expect(readFileSync(file, 'utf8')).toBe(drafts[index]);
});

test('AC2/AC5: quit Save all writes the other file but a read-only target keeps the app and failing edit open', async ({ cod: { page, app }, projects }) => {
  const firstId = await addFolder(page, projects.orchard);
  const first = path.join(projects.orchard, 'scratch.txt');
  const failing = path.join(projects.harbor, 'sample.ts');
  const original = readFileSync(failing, 'utf8');
  await modify(page, first, 'AC2 quit saved draft');
  await page.keyboard.press(newWorkspaceKey);
  const failingId = await addFolder(page, projects.harbor);
  await modify(page, failing, 'AC2 quit retained draft');
  // Leave the successful workspace active to prove the error reveals the other tab.
  await page.keyboard.press(toPlaywright(keys.previous));
  await expect(area(page)).toHaveAttribute('data-workspace-id', firstId);
  const fileMode = statSync(failing).mode & 0o7777;
  const folderMode = statSync(projects.harbor).mode & 0o7777;
  try {
    chmodSync(failing, 0o444);
    // The atomic writer creates a sibling and renames it. Deny directory writes too.
    chmodSync(projects.harbor, 0o555);
    expect(() => accessSync(projects.harbor, constants.W_OK), 'Prerequisite: run as an unprivileged user so the temporary directory is really read-only').toThrow();
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
    await expectPrompt(page, ['scratch.txt', 'sample.ts']);
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toBeHidden();
    expect(page.isClosed(), 'A failed quit save must keep the app window alive').toBe(false);
    expect(app.process().exitCode).toBeNull();
    expect(app.process().signalCode).toBeNull();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(workspace(page, firstId)).toBeVisible();
    await expect(workspace(page, failingId)).toBeVisible();
    await expect(area(page)).toHaveAttribute('data-workspace-id', failingId);
    await expect(editorTab(page, failing)).toHaveAttribute('aria-selected', 'true');
    await expect(area(page).getByTestId('editor-notice')).toContainText(/Could not save sample\.ts: .+/);
    await expectText(page, 'AC2 quit retained draft');
    await expect(editorTab(page, failing).getByTestId('editor-unsaved-indicator')).toBeVisible();
    expect(readFileSync(failing, 'utf8')).toBe(original);
    await expect.poll(() => readFileSync(first, 'utf8')).toBe('AC2 quit saved draft');
    await page.keyboard.press(toPlaywright(keys.previous));
    await expect(area(page)).toHaveAttribute('data-workspace-id', firstId);
    await openFile(page, first);
    await expectText(page, 'AC2 quit saved draft');
    await expect(editorTab(page, first).getByTestId('editor-unsaved-indicator')).toBeHidden();
  } finally {
    // Restore permissions even on assertion failure, before the fixture is deleted.
    chmodSync(projects.harbor, folderMode);
    chmodSync(failing, fileMode);
  }
  await page.keyboard.press(toPlaywright(keys.next));
  await expect(area(page)).toHaveAttribute('data-workspace-id', failingId);
  await saveCurrent(page, failing, 'AC2 quit retained draft');
});
