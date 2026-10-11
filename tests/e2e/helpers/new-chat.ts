import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { root } from './electron';

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
export const newChatKey = `${modifier}+n`;
const binary = path.join(root, 'tests/fakes/claude/claude');
export const streamingFlags = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
export type RecordLine = { kind: string; pid?: number; argv?: string[]; cwd?: string; session_id?: string; history?: unknown[] };
type Settings = 'absent' | 'no-key' | 'default' | 'invalid-json' | 'missing-folder';
export type Fixture = {
  page: Page;
  home: string;
  folders: string[];
  defaultFolder: string;
  missingFolder: string;
  settingsFile: string;
  records(): RecordLine[];
  resume(session: string): Promise<{ code: number | null; stdout: string; stderr: string }>;
};
type Run = (settings: Settings, body: (fixture: Fixture) => Promise<void>) => Promise<void>;

// A separate Electron launch per settings variant avoids changing settings after
// startup and gives each case its own profile, home, config and fake session store.
export const test = base.extend<{ run: Run }>({
  run: async ({}, use, testInfo) => {
    let variant = 0;
    await use(async (settings, body) => {
      const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-30-')));
      const home = path.join(directory, 'home');
      const config = path.join(directory, 'config');
      const claudeConfig = path.join(directory, 'claude-config');
      const profile = path.join(directory, 'profile');
      const defaultFolder = path.join(directory, 'default-chat');
      const missingFolder = path.join(directory, 'missing-chat');
      const folders = ['orchard', 'harbor'].map(name => path.join(directory, name));
      const settingsFile = path.join(config, 'cod/settings.json');
      const log = path.join(claudeConfig, 'claude.jsonl');
      for (const folder of [home, config, claudeConfig, profile, defaultFolder, ...folders, path.dirname(settingsFile)]) mkdirSync(folder, { recursive: true });
      for (const folder of folders) {
        writeFileSync(path.join(folder, 'notes.txt'), 'Invented story 30 fixture.\n');
        execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
      }
      if (settings === 'no-key') writeFileSync(settingsFile, '{ "invented_unused_key": true }\n');
      if (settings === 'default') writeFileSync(settingsFile, `// Story 30 invented JSONC settings\n{ "default_chat_folder": ${JSON.stringify(defaultFolder)} }\n`);
      if (settings === 'invalid-json') writeFileSync(settingsFile, '{ "default_chat_folder": ');
      if (settings === 'missing-folder') writeFileSync(settingsFile, JSON.stringify({ default_chat_folder: missingFolder }));
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      for (const name of Object.keys(env)) {
        if (/^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name) || name.startsWith('COD_')) delete env[name];
      }
      delete env.ELECTRON_RUN_AS_NODE;
      Object.assign(env, {
        HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: config, CLAUDE_CONFIG_DIR: claudeConfig,
        COD_USER_DATA_DIR: profile, COD_CLAUDE_BIN: binary, COD_FAKE_CLAUDE_LOG: log,
        COD_FAKE_CLAUDE_SCENARIO: 'reply', COD_FAKE_CLAUDE_UNIQUE_SESSIONS: '1',
        COD_TEST_PICK_FOLDERS: JSON.stringify(folders.map(folder => [folder])),
      });
      const records = (): RecordLine[] => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine) : [];
      let app: ElectronApplication | undefined;
      let page: Page | undefined;
      try {
        app = await _electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, env, timeout: 15_000 });
        page = await app.firstWindow({ timeout: 15_000 });
        await page.waitForLoadState('load');
        await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
        await body({
          page, home, folders, defaultFolder, missingFolder, settingsFile, records,
          resume: session => new Promise((resolve, reject) => {
            // Use the same invented fake store as Cod, never the operator's CLI.
            const child = spawn(binary, [...streamingFlags, '--resume', session], { cwd: home, env, timeout: 5_000 });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => { stdout += chunk; });
            child.stderr.on('data', chunk => { stderr += chunk; });
            child.on('error', reject);
            child.stdin.on('error', reject);
            child.on('close', code => resolve({ code, stdout, stderr }));
            child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Resume the old invented conversation' } })}\n`);
          }),
        });
      } finally {
        const label = `${++variant}-${settings}`;
        try {
          if (page && !page.isClosed() && testInfo.status !== testInfo.expectedStatus) await testInfo.attach(`story-30-${label}-window`, { body: await page.screenshot(), contentType: 'image/png' });
          if (existsSync(log)) await testInfo.attach(`story-30-${label}-fake-log`, { body: readFileSync(log), contentType: 'application/x-ndjson' });
        } finally {
          try {
            if (app) {
              const child = app.process();
              if (child.exitCode === null && child.signalCode === null) {
                const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
                const killTimeout = setTimeout(() => child.kill('SIGKILL'), 2_000);
                try {
                  void app.evaluate(({ app }) => app.exit(0)).catch(() => {});
                  await exited;
                } finally { clearTimeout(killTimeout); }
              }
            }
          } finally { rmSync(directory, { recursive: true, force: true }); }
        }
      }
    });
  },
});

export const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
export const composer = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Claude' });
export const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');
export const starts = (fixture: Fixture) => fixture.records().filter(record => record.kind === 'start');

export async function openInitialChat(page: Page): Promise<void> {
  if (await page.getByTestId('start-screen').isVisible()) await page.keyboard.press(newChatKey);
  await expect(chat(page), 'Prerequisite: story #8 chat, opened with Cmd-N/Ctrl-N when story #29 start screen is visible').toBeVisible();
}

export async function send(page: Page, message: string): Promise<void> {
  await composer(page).focus();
  await page.keyboard.insertText(message);
  await page.keyboard.press('Enter');
  await expect(chat(page).getByTestId('chat-user-message').last()).toHaveText(message);
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
}

export async function replaceChat(page: Page): Promise<void> {
  await composer(page).focus();
  await page.keyboard.press(newChatKey);
  await expect(chat(page), 'Story #30: Cmd-N/Ctrl-N must leave a visible fresh chat').toBeVisible();
  await expect(chat(page).getByTestId('chat-user-message'), 'Story #30: Cmd-N/Ctrl-N must clear the old user history').toHaveCount(0);
  await expect(replies(page), 'Story #30: Cmd-N/Ctrl-N must clear the old assistant history').toHaveCount(0);
  await expect(chat(page).getByTestId('chat-tool-call')).toHaveCount(0);
}

export { expect };
