import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root } from './helpers/electron';

type RecordLine = { kind: string; pid: number; argv?: string[]; name?: string; mode?: string; request?: { subtype: string; mode?: string }; event?: { type: string } };
type Fixture = {
  open: (defaultMode?: 'auto', reportMode?: boolean) => Promise<Page>;
  records: () => RecordLine[];
  release: (name: string) => void;
};
const test = base.extend<{ fixture: Fixture }>({
  fixture: async ({}, use, testInfo) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cod-story-33-'));
    const log = path.join(directory, 'claude.jsonl');
    const gates = path.join(directory, 'gates');
    mkdirSync(gates);
    const apps: ElectronApplication[] = [];
    const records = () => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine) : [];
    try {
      await use({ records, release: name => writeFileSync(path.join(gates, name), 'release'), open: async (defaultMode, reportMode = false) => {
        const instance = path.join(directory, String(apps.length));
        const config = path.join(instance, 'claude-config');
        mkdirSync(config, { recursive: true });
        writeFileSync(path.join(config, 'settings.json'), JSON.stringify(defaultMode ? { permissions: { defaultMode } } : {}));
        const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
        delete env.ELECTRON_RUN_AS_NODE;
        for (const name of Object.keys(env)) if (/^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name)) delete env[name];
        const profile = path.join(instance, 'profile');
        const app = await _electron.launch({
          args: [root, `--user-data-dir=${profile}`], cwd: root, timeout: 15_000,
          env: { ...env, COD_USER_DATA_DIR: profile, CLAUDE_CONFIG_DIR: config,
            COD_CLAUDE_BIN: path.join(root, 'tests/fakes/claude/permission-mode.cjs'),
            COD_FAKE_CLAUDE_LOG: log, COD_FAKE_CLAUDE_GATES: gates,
            COD_FAKE_CLAUDE_MODE_REPORT: reportMode ? '1' : '0' },
          recordVideo: { dir: testInfo.outputPath(`video-${apps.length}`) },
        });
        apps.push(app);
        const page = await app.firstWindow();
        await page.waitForLoadState('load');
        if (await page.getByTestId('start-screen').isVisible()) {
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
        }
        await expect(chat(page), 'Prerequisite #8 chat must exist; failure here is not the #33 red baseline').toBeVisible();
        return page;
      } });
    } finally {
      for (const app of apps) {
        const page = app.windows()[0];
        if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
          await testInfo.attach('permission-mode-window', { body: await page.screenshot(), contentType: 'image/png' });
        }
        const child = app.process();
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
          const kill = setTimeout(() => child.kill('SIGKILL'), 2_000);
          try { void app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited; }
          finally { clearTimeout(kill); }
        }
      }
      if (existsSync(log)) await testInfo.attach('permission-mode-protocol', { body: readFileSync(log), contentType: 'application/x-ndjson' });
      rmSync(directory, { recursive: true, force: true });
    }
  },
});
const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
const composer = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Claude', exact: true });
const selector = (page: Page) => chat(page).getByTestId('chat-composer-area').getByTestId('chat-permission-mode');
async function label(page: Page, name: string) {
  await expect(selector(page), `Story #33 composer permission mode must show ${name}`).toBeVisible();
  await expect(selector(page)).toHaveText(name);
  await expect(selector(page)).toHaveRole('button');
  await expect(chat(page).getByTestId('chat-composer-area').getByRole('textbox', { name: 'Message Claude', exact: true })).toBeVisible();
}
async function send(page: Page) {
  await composer(page).focus();
  await page.keyboard.insertText('Use the invented permission mode fixture');
  await page.keyboard.press('Enter');
}
async function running(page: Page, fixture: Fixture) {
  await send(page);
  await expect(chat(page).getByTestId('chat-assistant-message').last()).toHaveText('First fragment');
  await expect.poll(() => fixture.records().filter(record => record.kind === 'gate').map(record => record.name)).toContain('finish');
}
const starts = (fixture: Fixture) => fixture.records().filter(record => record.kind === 'start');
function startMode(record: RecordLine) {
  const argv = record.argv!;
  return argv.includes('--permission-mode') ? argv[argv.indexOf('--permission-mode') + 1] : undefined;
}

test('AC1: composer shows the current permission mode by name', async ({ fixture }, testInfo) => {
  const page = await fixture.open();
  await label(page, 'Manual');
  await testInfo.attach('composer-mode-look-check', { body: await page.screenshot(), contentType: 'image/png' });
});

test('AC2: Shift+Tab cycles all four modes and the mode menu supports mouse and keyboard', async ({ fixture }) => {
  const page = await fixture.open();
  await label(page, 'Manual');
  await composer(page).focus();
  await page.keyboard.insertText('Preserve this draft');
  for (const name of ['Accept Edits', 'Plan', 'Auto', 'Manual']) {
    await page.keyboard.press('Shift+Tab');
    await label(page, name);
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveValue('Preserve this draft');
  }
  const menu = chat(page).getByRole('menu', { name: 'Permission mode', exact: true });
  await selector(page).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Manual', 'Accept Edits', 'Plan', 'Auto']);
  await expect(menu.getByRole('menuitemradio', { name: 'Manual', exact: true })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Auto', exact: true }).click();
  await label(page, 'Auto');
  await expect(menu).toBeHidden();
  // Reach the selector by actual Tab navigation, without focusing it via DOM.
  await composer(page).focus();
  for (let count = 0; count < 40; count++) {
    await page.keyboard.press('Tab');
    if (await selector(page).evaluate(element => element === document.activeElement)) break;
  }
  await expect(selector(page), 'Permission mode selector must be reachable using Tab').toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Auto', exact: true })).toHaveAttribute('aria-checked', 'true');
  const manual = menu.getByRole('menuitemradio', { name: 'Manual', exact: true });
  await page.keyboard.press('Home');
  await expect(manual).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Accept Edits', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await label(page, 'Accept Edits');
  await expect(menu).toBeHidden();
  expect(starts(fixture), 'Changing the mode before sending must not start Claude').toHaveLength(0);
});

test('AC3: isolated Claude defaultMode auto controls new chats and startup, with Manual fallback', async ({ fixture }) => {
  const auto = await fixture.open('auto');
  await label(auto, 'Auto');
  await running(auto, fixture);
  expect(starts(fixture)).toHaveLength(1);
  expect(startMode(starts(fixture)[0]), 'Configured Auto must reach the first Claude process').toBe('auto');

  const manual = await fixture.open();
  await label(manual, 'Manual');
  await running(manual, fixture);
  expect(starts(fixture)).toHaveLength(2);
  // An omitted flag is the CLI's default Manual mode.
  expect(startMode(starts(fixture)[1]) ?? 'manual').toBe('manual');
});

test('AC4: mode changes reach the running Claude process without restarting it', async ({ fixture }) => {
  const page = await fixture.open();
  await label(page, 'Manual');
  await running(page, fixture);
  expect(starts(fixture)).toHaveLength(1);
  const pid = starts(fixture)[0].pid;
  await composer(page).focus();
  const changes = [
    { label: 'Accept Edits', mode: 'acceptEdits' },
    { label: 'Plan', mode: 'plan' },
    { label: 'Auto', mode: 'auto' },
    { label: 'Manual', mode: 'manual' },
  ];
  for (const [index, change] of changes.entries()) {
    await page.keyboard.press('Shift+Tab');
    await label(page, change.label);
    await expect(composer(page)).toBeFocused();
    await expect.poll(() => fixture.records().filter(record => record.kind === 'control-request' && record.request?.subtype === 'set_permission_mode').map(record => ({ pid: record.pid, mode: record.request?.mode })),
      { message: 'Mode changes must reach the same running Claude via set_permission_mode' }).toEqual(changes.slice(0, index + 1).map(change => ({ pid, mode: change.mode })));
    expect(starts(fixture), 'Changing permission mode must not restart Claude').toHaveLength(1);
    expect(fixture.records().filter(record => record.kind === 'signal' || record.kind === 'error')).toHaveLength(0);
  }
  fixture.release('finish');
  await expect(chat(page).getByTestId('chat-assistant-message').last()).toHaveText('First fragment and final fragment.');
  await expect(chat(page).getByTestId('chat-assistant-message').last()).toHaveAttribute('data-state', 'complete');
  expect(starts(fixture)).toHaveLength(1);
  expect(fixture.records().filter(record => record.kind === 'signal' || record.kind === 'error')).toHaveLength(0);
});

test('AC5: choosing a mode before the first message sets Claude startup permission-mode', async ({ fixture }) => {
  const page = await fixture.open();
  await label(page, 'Manual');
  await composer(page).focus();
  await page.keyboard.press('Shift+Tab');
  await label(page, 'Accept Edits');
  await page.keyboard.press('Shift+Tab');
  await label(page, 'Plan');
  expect(starts(fixture), 'Selecting a mode alone must not start Claude').toHaveLength(0);
  await running(page, fixture);
  expect(starts(fixture)).toHaveLength(1);
  expect(startMode(starts(fixture)[0]), 'The first message must launch Claude with the chosen mode').toBe('plan');
  await label(page, 'Plan');
});

test('AC6: the label follows a permission mode reported by Claude itself', async ({ fixture }) => {
  const page = await fixture.open(undefined, true);
  await label(page, 'Manual');
  await composer(page).focus();
  await page.keyboard.press('Shift+Tab');
  await label(page, 'Accept Edits');
  await page.keyboard.press('Shift+Tab');
  await label(page, 'Plan');
  await send(page);
  await expect(chat(page).getByTestId('chat-assistant-message').last()).toHaveText('First fragment');
  await expect.poll(() => fixture.records().filter(record => record.kind === 'gate').map(record => record.name)).toContain('report-mode');
  expect(startMode(starts(fixture)[0])).toBe('plan');
  const before = fixture.records().filter(record => record.kind === 'control-request' && record.request?.subtype === 'set_permission_mode');
  fixture.release('report-mode');
  await expect.poll(() => fixture.records().filter(record => record.kind === 'mode-report').map(record => record.mode)).toEqual(['manual']);
  await label(page, 'Manual');
  fixture.release('finish');
  await expect(chat(page).getByTestId('chat-assistant-message').last()).toHaveAttribute('data-state', 'complete');
  await label(page, 'Manual');
  expect(starts(fixture), 'A process-reported mode must not restart Claude').toHaveLength(1);
  expect(fixture.records().filter(record => record.kind === 'control-request' && record.request?.subtype === 'set_permission_mode'), 'A reported mode must not be echoed as a new user mode request').toEqual(before);
  expect(fixture.records().filter(record => record.kind === 'signal' || record.kind === 'error')).toHaveLength(0);
});
