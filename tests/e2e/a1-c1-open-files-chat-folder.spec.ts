import { test, expect, _electron } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Story #34 regression: the chat's own folder is an allowed root even when it is not a workspace folder.
const root = path.resolve(__dirname, '../..');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test('a file mentioned in the chat folder opens although the workspace has no folders', async () => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-34-chat-folder-')));
  const home = path.join(directory, 'home');
  const config = path.join(directory, 'config');
  const profile = path.join(directory, 'profile');
  const chatFolder = path.join(directory, 'chat-folder');
  const fake = path.join(directory, 'fake');
  for (const folder of [home, path.join(config, 'cod'), profile, path.join(chatFolder, 'src'), path.join(fake, 'scenarios'), path.join(directory, 'claude-config')]) mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(chatFolder, 'src/a.ts'), Array.from({ length: 10 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  writeFileSync(path.join(config, 'cod/settings.json'), JSON.stringify({ default_chat_folder: chatFolder }));
  cpSync(path.join(root, 'tests/fakes/claude/claude'), path.join(fake, 'claude'));
  cpSync(path.join(root, 'tests/fakes/claude/mcp-client.cjs'), path.join(fake, 'mcp-client.cjs'));
  const envelope = { session_id: '$SESSION', parent_tool_use_id: null, uuid: '$UUID' };
  const text = 'Look at src/a.ts:4:3 please.';
  writeFileSync(path.join(fake, 'scenarios/chat-folder.json'), JSON.stringify({ turns: [[
    { event: { ...envelope, type: 'system', subtype: 'init', cwd: '$CWD', tools: [], model: 'fake-claude', permissionMode: 'default', apiKeySource: 'none' } },
    { event: { ...envelope, type: 'assistant', message: { id: 'msg_chat_folder', type: 'message', role: 'assistant', model: 'fake-claude', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 5 } } } },
    { event: { ...envelope, type: 'result', subtype: 'success', is_error: false, result: text, errors: [], duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 5 } } },
  ]] }));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('COD_') && !/^(?:ANTHROPIC_|CLAUDE_)/.test(entry[0])));
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: config, CLAUDE_CONFIG_DIR: path.join(directory, 'claude-config'),
    COD_USER_DATA_DIR: profile, COD_CLAUDE_BIN: path.join(fake, 'claude'), COD_FAKE_CLAUDE_SCENARIO: 'chat-folder',
    COD_FAKE_CLAUDE_LOG: path.join(directory, 'claude.jsonl'),
  });
  const app = await _electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, env, timeout: 15_000 });
  try {
    const page = await app.firstWindow({ timeout: 15_000 });
    await page.waitForLoadState('load');
    if (await page.getByTestId('start-screen').isVisible()) await page.keyboard.press(`${modifier}+n`);
    const chat = page.getByTestId('workspace-area').getByTestId('claude-chat');
    await expect(chat.getByTestId('chat-working-directory')).toContainText(chatFolder);
    await expect(page.getByTestId('project-root')).toHaveCount(0);
    await chat.getByRole('textbox', { name: 'Message Claude' }).focus();
    await page.keyboard.insertText('Which file?');
    await page.keyboard.press('Enter');
    const link = chat.getByTestId('chat-assistant-message').last().getByRole('link', { name: 'src/a.ts:4:3', exact: true });
    await expect(link, 'a file in the chat folder must be a link').toBeVisible();
    await link.click();
    await expect(page.getByTestId('workspace-area').getByRole('tab', { selected: true })).toHaveAttribute('data-path', path.join(chatFolder, 'src/a.ts'));
    await expect(page.getByTestId('workspace-area').getByTestId('editor-content')).toBeFocused();
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});
