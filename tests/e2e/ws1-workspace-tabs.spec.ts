import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, root } from './helpers/electron';
import { keys, newWorkspaceKey, normalizeStroke, shortcuts, toPlaywright, zedBindings } from './helpers/zed-keymaps';

const tabs = (page: Page) => page.getByTestId('workspace-tab');
const labels = (page: Page) => page.getByTestId('workspace-tab-label');
const selected = (page: Page) => page.getByRole('tab', { selected: true });
const area = (page: Page) => page.getByTestId('workspace-area');

async function expectActive(page: Page, name: string) {
  await expect(selected(page)).toHaveCount(1);
  await expect(selected(page).getByTestId('workspace-tab-label')).toHaveText(name);
  // The visible area must belong to the selected workspace, not just a highlighted tab.
  const id = await selected(page).getAttribute('data-workspace-id');
  expect(id).toBeTruthy();
  await expect(area(page)).toHaveAttribute('data-workspace-id', id!);
  await expect(area(page)).toBeVisible();
  await expect(page.getByTestId('workspace-area').and(page.locator(':visible'))).toHaveCount(1);
  await expect(area(page).getByTestId('claude-chat')).toHaveAttribute('data-workspace-id', id!);
}

async function expectFresh(page: Page) {
  await expect(area(page).getByTestId(/^chat-(?:user-|assistant-)?message$/)).toHaveCount(0);
  await expect(area(page).getByTestId('editor-tab')).toHaveCount(0);
}

async function addByKeyboard(page: Page, expectedName: string) {
  await page.keyboard.press(newWorkspaceKey);
  await expectActive(page, expectedName);
  await expectFresh(page);
}

const theme = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/zed-themes/one.json'), 'utf8'));
const oneDark = theme.themes.find((item: { name: string }) => item.name === 'One Dark').style;
function rgb(token: string): string {
  const hex = oneDark[token];
  return `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
}

test('AC1: clean startup shows one empty workspace within 3 seconds in One Dark', async ({ cod }, testInfo) => {
  const { page, app, startedAt } = cod;
  await expect(page.getByTestId('cod-window')).toBeVisible();
  await expect(tabs(page)).toHaveCount(1);
  await expectActive(page, 'Workspace 1');
  await expectFresh(page);
  expect(performance.now() - startedAt, 'First window with its initial empty workspace must be ready within 3000 ms of Electron launch').toBeLessThanOrEqual(3000);
  expect(app.windows()).toHaveLength(1);
  await expect(page.getByTestId('cod-window')).toHaveCSS('background-color', rgb('background'));
  await expect(page.getByTestId('workspace-tab-bar')).toHaveCSS('background-color', rgb('tab_bar.background'));
  await expect(selected(page)).toHaveCSS('background-color', rgb('tab.active_background'));
  await expect(selected(page).getByTestId('workspace-tab-label')).toHaveCSS('color', rgb('text'));
  await expect(area(page)).toHaveCSS('background-color', rgb('editor.background'));
  await addByKeyboard(page, 'Workspace 2');
  await expect(tabs(page).nth(0)).toHaveCSS('background-color', rgb('tab.inactive_background'));
  await testInfo.attach('two-workspace-look-check', { body: await page.screenshot(), contentType: 'image/png' });
});

test('AC2: plus and the new-workspace key append numbered tabs and activate them', async ({ cod }) => {
  const { page, app } = cod;
  await page.getByTestId('workspace-add').click();
  await expect(labels(page)).toHaveText(['Workspace 1', 'Workspace 2']);
  await expectActive(page, 'Workspace 2');
  await expectFresh(page);
  await addByKeyboard(page, 'Workspace 3');
  await expect(labels(page)).toHaveText(['Workspace 1', 'Workspace 2', 'Workspace 3']);
  await expectFresh(page);
  expect(app.windows(), 'New workspace must stay in the same window').toHaveLength(1);
});

test('AC3: mouse and collision-free next/previous keys switch the active workspace', async ({ cod }) => {
  // Both platform maps are checked even when this test runs on only one platform.
  for (const platform of ['macos', 'linux'] as const) {
    const occupied = zedBindings(platform).map(binding => normalizeStroke(binding.split(/\s+/)[0]));
    for (const action of ['next', 'previous', 'close'] as const) {
      expect(occupied, `${platform} ${action}: ${shortcuts[platform][action]} must not collide in any Zed context or start a Zed chord`).not.toContain(normalizeStroke(shortcuts[platform][action]));
    }
  }
  const { page } = cod;
  await addByKeyboard(page, 'Workspace 2');
  await addByKeyboard(page, 'Workspace 3');
  await tabs(page).nth(0).click();
  await expectActive(page, 'Workspace 1');
  await page.keyboard.press(toPlaywright(keys.next));
  await expectActive(page, 'Workspace 2');
  await page.keyboard.press(toPlaywright(keys.next));
  await expectActive(page, 'Workspace 3');
  await page.keyboard.press(toPlaywright(keys.previous));
  await expectActive(page, 'Workspace 2');
  await tabs(page).nth(2).click();
  await expectActive(page, 'Workspace 3');
});

test('AC4: close button and close key select a neighbour and replace the last workspace', async ({ cod }) => {
  const { page, app } = cod;
  await addByKeyboard(page, 'Workspace 2');
  await addByKeyboard(page, 'Workspace 3');
  await tabs(page).nth(1).click();
  await expectActive(page, 'Workspace 2');
  await selected(page).getByTestId('workspace-close').click();
  await expect(labels(page)).toHaveText(['Workspace 1', 'Workspace 3']);
  await expect(selected(page).getByTestId('workspace-tab-label')).toHaveText(/^Workspace (1|3)$/);
  await tabs(page).nth(1).click();
  await expectActive(page, 'Workspace 3');
  await page.keyboard.press(toPlaywright(keys.close));
  await expect(labels(page)).toHaveText(['Workspace 1']);
  await expectActive(page, 'Workspace 1');

  // Test the last-workspace rule through both close paths.
  for (const method of ['keyboard', 'mouse'] as const) {
    const oldId = await selected(page).getAttribute('data-workspace-id');
    if (method === 'keyboard') await page.keyboard.press(toPlaywright(keys.close));
    else await selected(page).getByTestId('workspace-close').click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(selected(page)).toHaveCount(1);
    await expect(selected(page)).not.toHaveAttribute('data-workspace-id', oldId!);
    const newId = await selected(page).getAttribute('data-workspace-id');
    expect(newId).toBeTruthy();
    await expect(area(page)).toHaveAttribute('data-workspace-id', newId!);
    await expect(area(page)).toBeVisible();
    await expectActive(page, (await selected(page).getByTestId('workspace-tab-label').innerText()));
    await expectFresh(page);
    expect(app.windows()).toHaveLength(1);
  }
});

test('AC5: the PR suite drives a real Electron window on the Linux CI runner', async ({ cod }, testInfo) => {
  // The workflow runs this entire file under Xvfb. A green CI run is the evidence
  // for AC5; this smoke scenario alone cannot prove the entire suite is green.
  testInfo.annotations.push({ type: 'CI evidence', description: '.github/workflows/e2e.yml / e2e job must pass on the implementation PR' });
  await expect(cod.page.getByTestId('cod-window')).toBeVisible();
  await expect(tabs(cod.page)).toHaveCount(1);
  await expectActive(cod.page, 'Workspace 1');
  expect(cod.app.windows()).toHaveLength(1);
  if (process.env.GITHUB_ACTIONS) expect(process.platform).toBe('linux');
});
