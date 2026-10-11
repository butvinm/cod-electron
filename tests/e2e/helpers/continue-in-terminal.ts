import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test as base, expect, root } from './electron';

type RecordLine = { kind: string; pid: number; argv?: string[]; cwd?: string; session_id?: string; history?: unknown[]; code?: number; name?: string };
type Fake = { folder: string; records: () => RecordLine[]; release: () => void };
type Clipboard = { read: () => Promise<string>; seed: (text: string) => Promise<void> };
const credential = /^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i;

export const test = base.extend<{ terminalFake: Fake; terminalScenario: string; terminalClipboard: Clipboard }>({
  terminalScenario: ['reply', { option: true }],
  terminalFake: [async ({ terminalScenario }, use, testInfo) => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-35-')));
    const folder = path.join(directory, 'terminal orchard');
    const config = path.join(directory, 'claude-config');
    const gates = path.join(directory, 'gates');
    const log = path.join(directory, 'claude.jsonl');
    for (const dir of [folder, config, gates]) mkdirSync(dir);
    writeFileSync(path.join(folder, 'notes.txt'), 'Invented terminal handoff fixture.\n');
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
    const overrides: Record<string, string | undefined> = {
      COD_CLAUDE_BIN: path.join(root, 'tests/fakes/claude/claude'),
      COD_FAKE_CLAUDE_LOG: log,
      COD_FAKE_CLAUDE_GATES: gates,
      COD_FAKE_CLAUDE_SCENARIO: terminalScenario,
      COD_TEST_PICK_FOLDERS: JSON.stringify([[folder]]),
      CLAUDE_CONFIG_DIR: config,
    };
    for (const name of Object.keys(process.env)) if (credential.test(name)) overrides[name] = undefined;
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    const records = (): RecordLine[] => existsSync(log)
      ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine)
      : [];
    try {
      for (const [name, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      await use({ folder, records, release: () => writeFileSync(path.join(gates, 'finish'), 'release') });
    } finally {
      try {
        if (existsSync(log)) await testInfo.attach('story-35-fake-log', { body: readFileSync(log), contentType: 'application/x-ndjson' });
      } finally {
        for (const [name, value] of previous) {
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }, { auto: true }],
  terminalClipboard: [async ({ cod: { app } }, use) => {
    // Inspect the OS clipboard only; never invoke Cod's handoff implementation.
    const saved = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage().toDataURL() }));
    try {
      await use({
        read: () => app.evaluate(({ clipboard }) => clipboard.readText()),
        seed: text => app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text),
      });
    } finally {
      await app.evaluate(({ clipboard, nativeImage }, value) => clipboard.write({ text: value.text, html: value.html, rtf: value.rtf, image: nativeImage.createFromDataURL(value.image) }), saved);
    }
  }, { auto: true }],
});

export { expect };
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
export const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
export const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');
export const composer = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Claude' });
export const button = (page: Page) => chat(page).getByRole('button', { name: 'Continue in Terminal', exact: true });

export async function prepareChat(page: Page, folder: string) {
  if (await page.getByTestId('start-screen').isVisible()) await page.keyboard.press(`${modifier}+n`);
  await page.keyboard.press(`${modifier}+Shift+e`);
  const panel = page.getByTestId('project-panel');
  await expect(panel).toBeVisible();
  const oldAdd = panel.getByTestId('project-add-folder');
  if (await oldAdd.isVisible()) {
    await oldAdd.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.press(`${modifier}+Shift+a`);
  }
  await expect(panel.getByTestId('project-root')).toHaveAttribute('data-path', folder);
  if (await page.getByTestId('start-screen').isVisible()) await page.keyboard.press(`${modifier}+n`);
  await expect(chat(page), 'Prerequisite: the Claude chat must open before testing story #35').toBeVisible();
  await expect(chat(page).getByTestId('chat-working-directory')).toContainText(folder);
}

export async function send(page: Page, text: string) {
  await composer(page).focus();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect(chat(page).getByTestId('chat-user-message').last()).toHaveText(text);
}

export async function idleSession(page: Page) {
  await send(page, 'Remember the first message');
  await expect(replies(page).last()).toContainText('Hello from fake Claude.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  const id = chat(page).getByTestId('chat-session-id');
  await expect(id).toHaveText(/^[0-9a-f-]{36}$/i);
  return (await id.innerText()).trim();
}

export async function requireButton(page: Page) {
  await expect(button(page), 'Story #35 Continue in Terminal button is missing from the chat').toBeVisible();
  await expect(chat(page).getByTestId('chat-header').getByRole('button', { name: 'Continue in Terminal', exact: true })).toBeVisible();
}

export async function tabTo(page: Page, target: Locator) {
  await composer(page).focus();
  for (let count = 0; count < 40; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  await expect(target, 'Continue in Terminal must be reachable by Tab from the composer').toBeFocused();
}

export async function copyCommand(page: Page) {
  await requireButton(page);
  await expect(button(page)).toBeEnabled();
  await tabTo(page, button(page));
  await page.keyboard.press('Enter');
}

export function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
