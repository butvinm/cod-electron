import { test as base, expect, root } from './electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
export const historyKey = `${modifier}+g`;
export const binary = path.join(root, 'tests/fakes/claude/36-session-store.cjs');
export const streamingFlags = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
export const ids = {
  home: '550e8400-e29b-41d4-a716-446655440361',
  orchard: '550e8400-e29b-41d4-a716-446655440362',
  harbor: '550e8400-e29b-41d4-a716-446655440363',
  unrelated: '550e8400-e29b-41d4-a716-446655440364',
};
export type StoreRecord = { type: string; message: { role: string; content: unknown }; uuid: string; parentUuid: string | null; sessionId: string; cwd: string; timestamp: string };
type CliRecord = { kind: string; pid: number; argv?: string[]; cwd?: string; line?: string; session_id?: string };
type Store = { directory: string; config: string; log: string; folders: string[]; seed: (folder: string, id: string, title: string, days: number, tools?: boolean) => StoreRecord[]; records: () => CliRecord[] };
export const storeFile = (config: string, folder: string, id: string) => path.join(config, 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);

export const test = base.extend<{ store: Store }>({
  store: [async ({}, use, testInfo) => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-36-')));
    const config = path.join(directory, 'claude-config');
    const log = path.join(directory, 'cli.jsonl');
    const folders = ['orchard', 'harbor'].map(name => path.join(directory, name));
    mkdirSync(path.join(config, 'projects'), { recursive: true });
    for (const folder of folders) {
      mkdirSync(folder);
      writeFileSync(path.join(folder, 'notes.txt'), 'Invented fixture contents.');
      execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
    }
    const overrides: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: config, COD_CLAUDE_BIN: binary, COD_FAKE_CLAUDE_LOG: log,
      COD_TEST_PICK_FOLDERS: JSON.stringify([folders]), COD_FAKE_CLAUDE_SCENARIO: undefined,
    };
    for (const name of Object.keys(process.env)) {
      if (/^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name)) overrides[name] = undefined;
    }
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const seed: Store['seed'] = (folder, id, title, days, tools = false) => {
      const timestamp = new Date(Date.now() - days * 86_400_000).toISOString();
      const messages: { type: string; message: StoreRecord['message'] }[] = [
        { type: 'user', message: { role: 'user', content: title } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Old assistant reply.' }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Read the saved notes' }] } },
      ];
      if (tools) messages.push(
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_saved_36', name: 'Read', input: { file_path: 'notes.txt' } }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_saved_36', content: 'Invented fixture contents.', is_error: false }] } },
      );
      messages.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Read complete.' }] } });
      let parentUuid: string | null = null;
      const lines: StoreRecord[] = messages.map(({ type, message }) => {
        const record = { type, message, uuid: randomUUID(), parentUuid, sessionId: id, cwd: folder, timestamp, version: '2.1.296', userType: 'external', isSidechain: false };
        parentUuid = record.uuid;
        return record;
      });
      const file = storeFile(config, folder, id);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
      return lines;
    };
    const records = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as CliRecord) : [];
    try { await use({ directory, config, log, folders, seed, records }); }
    finally {
      if (existsSync(log)) await testInfo.attach('story-36-fake-cli', { path: log, contentType: 'application/x-ndjson' });
      for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});
export { expect, homedir };
export const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
export const picker = (page: Page) => page.getByRole('dialog', { name: 'Claude sessions' });
export const options = (page: Page) => picker(page).getByRole('option');
export const composer = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Claude' });
export async function ensureChat(page: Page) {
  if (await page.getByTestId('start-screen').isVisible()) await page.keyboard.press(`${modifier}+n`);
  await expect(chat(page), 'Prerequisite: Claude chat must be visible before testing #36').toBeVisible();
}
export async function openHistory(page: Page) {
  await composer(page).focus();
  await page.keyboard.press(historyKey);
  await expect(picker(page), 'Story #36 session picker is missing: agent history must open the workspace Claude sessions').toBeVisible();
  await expect(picker(page).getByRole('textbox', { name: 'Filter Claude sessions' })).toBeFocused();
}
export async function selectSession(page: Page, title: string) {
  await openHistory(page);
  await page.keyboard.insertText(title);
  await expect(options(page)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeHidden();
}
export async function addFolders(page: Page) {
  await page.keyboard.press(`${modifier}+Shift+e`);
  const panel = page.getByTestId('project-panel');
  await expect(panel).toBeVisible();
  // #29 removes this button and uses Zed's AddFolderToProject shortcut.
  const oldButton = panel.getByTestId('project-add-folder');
  if (await oldButton.isVisible()) { await oldButton.focus(); await page.keyboard.press('Enter'); }
  else await page.keyboard.press(`${modifier}+Shift+a`);
  await expect(panel.getByTestId('project-root')).toHaveCount(2);
  await ensureChat(page);
}
export async function send(page: Page, text: string) {
  await composer(page).focus();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect(chat(page).getByTestId('chat-user-message').last()).toHaveText(text);
  await expect(chat(page).getByTestId('chat-assistant-message').last()).toHaveAttribute('data-state', 'complete');
}
