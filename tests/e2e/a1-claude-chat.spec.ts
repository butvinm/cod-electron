import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import type { Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';
import { newWorkspaceKey, keys, toPlaywright } from './helpers/zed-keymaps';

const binary = path.join(root, 'tests/fakes/claude/claude');
const streamingFlags = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
const credentialName = /^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i;
type RecordLine = { kind: string; type?: string; pid: number; argv?: string[]; envNames?: string[]; cwd?: string; line?: string; session_id?: string; history?: unknown[] };
type Fake = { directory: string; log: string; gates: string; folders: string[]; records: () => RecordLine[] };
// Automatic fixtures run before the harness launches Electron. Restore the worker's
// environment after every test; the shared harness still owns app/profile cleanup.
const test = base.extend<{ fake: Fake; scenario: string; firstFolder: boolean }>({
  scenario: ['reply', { option: true }],
  firstFolder: [false, { option: true }],
  fake: [async ({ scenario, firstFolder }, use) => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-8-')));
    const log = path.join(directory, 'claude.jsonl');
    const gates = path.join(directory, 'gates');
    mkdirSync(gates);
    const folders = firstFolder ? ['orchard', 'harbor'].map(name => path.join(directory, name)) : [];
    const overrides: Record<string, string | undefined> = {
      COD_CLAUDE_BIN: scenario === 'missing' ? path.join(directory, 'missing-claude') : binary,
      COD_FAKE_CLAUDE_LOG: log,
      COD_FAKE_CLAUDE_GATES: gates,
      COD_FAKE_CLAUDE_SCENARIO: scenario === 'missing' ? 'reply' : scenario,
      COD_TEST_PICK_FOLDERS: firstFolder ? JSON.stringify(folders.map(folder => [folder])) : undefined,
    };
    // Never expose credentials from the operator's shell to this suite.
    for (const name of Object.keys(process.env)) if (credentialName.test(name)) overrides[name] = undefined;
    // Invented values probe whether Cod passes credentials to its CLI child.
    overrides.ANTHROPIC_API_KEY = 'story-8-invented-api-sentinel';
    overrides.CLAUDE_CODE_OAUTH_TOKEN = 'story-8-invented-oauth-sentinel';
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const records = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine) : [];
    try {
      for (const folder of folders) {
        cpSync(path.join(root, 'tests/fixtures/projects', path.basename(folder)), folder, { recursive: true });
        execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
      }
      await use({ directory, log, gates, folders, records });
    }
    finally {
      for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});
const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
const composer = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Claude' });
const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');
async function requireChat(page: Page) {
  await expect(chat(page), 'Story #8 Claude chat is missing: each workspace needs a visible chat pane').toBeVisible();
}
async function send(page: Page, message: string) {
  await composer(page).focus();
  await page.keyboard.insertText(message);
  await page.keyboard.press('Enter');
  await expect(chat(page).getByTestId('chat-user-message').last()).toHaveText(message);
}
async function tabTo(page: Page, locator: ReturnType<Page['getByTestId']>) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate(element => element === document.activeElement)) return;
  }
  await expect(locator, 'Tool summary must be reachable using Tab').toBeFocused();
}

test.describe('AC1', () => {
  test.use({ scenario: 'stream' });
  test('AC1: each workspace has a chat, Enter sends, Shift+Enter inserts a newline and replies stream', async ({ cod: { page }, fake }) => {
    await requireChat(page);
    await composer(page).focus();
    await page.keyboard.insertText('First line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.insertText('Second line');
    await expect(composer(page)).toHaveValue('First line\nSecond line');
    await expect(chat(page).getByTestId('chat-user-message')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(chat(page).getByTestId('chat-user-message')).toHaveText('First line\nSecond line');
    await expect(replies(page).last()).toHaveText('First fragment');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'streaming');
    expect(fake.records().filter(record => record.kind === 'emit' && record.type === 'result')).toHaveLength(0);
    writeFileSync(path.join(fake.gates, 'finish'), 'release');
    await expect(replies(page).last()).toHaveText('First fragment and final fragment.');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
    const input = fake.records().find(record => record.kind === 'stdin');
    expect(input).toBeTruthy();
    const content = JSON.parse(input!.line!).message.content;
    expect(typeof content === 'string' ? content : content.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('')).toBe('First line\nSecond line');
    await page.keyboard.press(newWorkspaceKey);
    await requireChat(page);
    await expect(chat(page).getByTestId('chat-user-message')).toHaveCount(0);
    await expect(replies(page)).toHaveCount(0);
    await page.keyboard.press(toPlaywright(keys.previous));
    await expect(replies(page).last()).toHaveText('First fragment and final fragment.');
  });
});

test.describe('AC2', () => {
  test.use({ scenario: 'tools' });
  test('AC2: collapsed tool summaries show name and target and expand by keyboard or click', async ({ cod: { page } }, testInfo) => {
    await requireChat(page);
    await send(page, 'Read notes.txt');
    const tool = chat(page).getByTestId('chat-tool-call');
    const summary = tool.getByRole('button', { name: /Read.*notes\.txt/ });
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(tool.getByTestId('chat-tool-input')).toBeHidden();
    await expect(tool.getByTestId('chat-tool-output')).toBeHidden();
    await composer(page).focus();
    await tabTo(page, summary);
    await page.keyboard.press('Enter');
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await expect(tool.getByTestId('chat-tool-input')).toContainText('notes.txt');
    await expect(tool.getByTestId('chat-tool-output')).toHaveText('Invented fixture contents.');
    await testInfo.attach('expanded-tool-look-check', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Enter');
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await summary.click();
    await expect(tool.getByTestId('chat-tool-output')).toBeVisible();
  });
});

test.describe('AC3', () => {
  test.use({ scenario: 'interrupt' });
  test('AC3: Esc stops the turn, marks it interrupted and the next message keeps the session', async ({ cod: { page }, fake }) => {
    await requireChat(page);
    await send(page, 'Start a long reply');
    await expect(replies(page).last()).toHaveText('Still working');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'streaming');
    const session = (await chat(page).getByTestId('chat-session-id').innerText()).trim();
    const start = fake.records().find(record => record.kind === 'start')!;
    await page.keyboard.press('Escape');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'interrupted');
    await expect(chat(page).getByTestId('chat-interrupted')).toHaveText(/interrupted/i);
    await expect.poll(() => { try { process.kill(start.pid, 0); return false; } catch { return true; } }, { message: 'Esc must stop the fake CLI, not just change the UI' }).toBe(true);
    await send(page, 'Continue after interrupt');
    await expect(replies(page).last()).toHaveText('Continuing the same conversation.');
    await expect(replies(page)).toHaveCount(2);
    await expect(replies(page).first()).toHaveAttribute('data-state', 'interrupted');
    await expect(chat(page).getByTestId('chat-session-id')).toHaveText(session);
    const starts = fake.records().filter(record => record.kind === 'start');
    expect(starts).toHaveLength(2);
    expect(starts[1].argv).toEqual(expect.arrayContaining(['--resume', session]));
    expect(fake.records().filter(record => record.kind === 'turn').map(record => record.session_id)).toEqual([session, session]);
  });
});

test('AC4: no-folder chat runs Claude in the user home and explains the working directory', async ({ cod: { page }, fake }) => {
  await requireChat(page);
  await expect(chat(page).getByTestId('chat-working-directory')).toContainText(homedir());
  await expect(chat(page).getByTestId('chat-working-directory')).toContainText(/home/i);
  await send(page, 'Where are we working?');
  await expect(replies(page).last()).toHaveText('Hello from fake Claude.');
  const starts = fake.records().filter(record => record.kind === 'start');
  expect(starts).toHaveLength(1);
  expect(starts[0].cwd).toBe(homedir());
});

test.describe('AC4 first folder', () => {
  test.use({ firstFolder: true });
  test('AC4: with two workspace folders Claude runs in the first folder and shows it', async ({ cod: { page }, fake }) => {
    await requireChat(page);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+Shift+e`);
    const panel = page.getByTestId('project-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('project-root')).toHaveCount(0);
    for (const [index, folder] of fake.folders.entries()) {
      const add = panel.getByTestId('project-add-folder');
      await add.focus();
      await page.keyboard.press('Enter');
      await expect(panel.getByTestId('project-root')).toHaveCount(index + 1);
      await expect(panel.getByTestId('project-root').nth(index)).toHaveAttribute('data-path', folder);
    }
    await expect(chat(page).getByTestId('chat-working-directory')).toContainText(fake.folders[0]);
    await expect(chat(page).getByTestId('chat-working-directory')).not.toContainText(fake.folders[1]);
    await send(page, 'Which folder are we working in?');
    await expect(replies(page).last()).toHaveText('Hello from fake Claude.');
    const starts = fake.records().filter(record => record.kind === 'start');
    expect(starts).toHaveLength(1);
    expect(starts[0].cwd).toBe(fake.folders[0]);
  });
});

for (const scenario of ['reply', 'missing', 'not-logged-in']) test.describe(`AC5 ${scenario}`, () => {
  test.use({ scenario });
  test(`AC5: ${scenario === 'reply' ? 'installed CLI uses streaming flags without bare mode or token env vars' : scenario === 'missing' ? 'missing CLI tells the user to install Claude' : 'logged-out CLI tells the user to run claude auth login'}`, async ({ cod: { page }, fake }) => {
    await requireChat(page);
    await send(page, 'Hello Claude');
    if (scenario === 'missing') {
      await expect(chat(page).getByTestId('chat-error')).toHaveText(/install.*claude|claude.*install/i);
      expect(fake.records()).toHaveLength(0);
    } else {
      if (scenario === 'not-logged-in') await expect(chat(page).getByTestId('chat-error')).toHaveText(/claude auth login/);
      else await expect(replies(page).last()).toHaveText('Hello from fake Claude.');
      await expect.poll(() => fake.records().filter(record => record.kind === 'start').length).toBe(1);
      const start = fake.records().find(record => record.kind === 'start')!;
      expect(start.argv).toEqual(expect.arrayContaining(streamingFlags));
      expect(start.argv).not.toContain('--bare');
      expect(start.argv).not.toContain('--no-session-persistence');
      expect(start.envNames!.filter(name => credentialName.test(name))).toEqual([]);
      expect(start.argv!.join(' ')).not.toMatch(/story-8-invented|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN/);
      expect(start.envNames).not.toContain('CLAUDE_CODE_SIMPLE');
    }
  });
});

test('AC6: displayed native session ID can be resumed by a separate CLI process', async ({ cod: { page }, fake }) => {
  await requireChat(page);
  await send(page, 'Remember the first message');
  await expect(replies(page).last()).toHaveText('Hello from fake Claude.');
  const session = (await chat(page).getByTestId('chat-session-id').innerText()).trim();
  expect(session).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(fake.records().find(record => record.kind === 'turn')!.session_id).toBe(session);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !credentialName.test(entry[0])));
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, [...streamingFlags, '--resume', session], { cwd: homedir(), env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Fake CLI resume timed out')); }, 5_000);
    child.on('close', code => { clearTimeout(deadline); if (code === 0) resolve(stdout); else reject(new Error(`Fake resume exited ${code}: ${stderr}`)); });
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue in terminal' } }) + '\n');
  });
  const result = output.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'result');
  expect(result).toMatchObject({ session_id: session, result: 'I remember the first message.', is_error: false });
  const starts = fake.records().filter(record => record.kind === 'start');
  expect(starts).toHaveLength(2);
  expect(starts[1].pid).not.toBe(starts[0].pid);
  expect(starts[1].argv).toEqual(expect.arrayContaining(['--resume', session]));
  const turns = fake.records().filter(record => record.kind === 'turn');
  expect(turns[1].history).toHaveLength(2);
  expect(turns[1].history![0]).toEqual(turns[0].history![0]);
});
