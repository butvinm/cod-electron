import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test as base, expect, root } from './electron';

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
export const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
export const composer = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Claude' });
export const reply = (page: Page) => chat(page).getByTestId('chat-assistant-message').last();
export const toolNames = ['Read', 'Edit', 'MultiEdit', 'Write'] as const;
export const contents = (label: string) => Array.from({ length: 20 }, (_, i) => `// ${label} line ${String(i + 1).padStart(2, '0')} abcdefghijklmnop`).join('\n') + '\n';
type Files = { directory: string; folders: string[]; outside: string; absolute: string };

function scenario(files: Files) {
  const envelope = { session_id: '$SESSION', parent_tool_use_id: null, uuid: '$UUID' };
  const toolInputs = [
    { file_path: 'src/read.ts' },
    { file_path: 'src/edit.ts', old_string: '// edit line 07 abcdefghijklmnop', new_string: '// edit line 07 CHANGED' },
    { file_path: 'src/multi.ts', edits: [
      { old_string: '// multi line 15 abcdefghijklmnop', new_string: '// multi line 15 CHANGED' },
      { old_string: '// multi line 04 abcdefghijklmnop', new_string: '// multi line 04 CHANGED' },
    ] },
    { file_path: 'src/write.ts', content: contents('write') },
  ];
  const text = [
    'Plain: src/a.ts, src/a.ts:12, src/a.ts:12:5.',
    'Inline: `src/a.ts`, `src/a.ts:12`, `src/a.ts:12:5`.',
    'Missing: src/missing.ts, src/missing.ts:12, `src/missing.ts:12:5`.',
    `Outside: ${files.outside}, \`${files.outside}:12:5\`, ../outside.ts.`,
    `Resolution: src/shared.ts:3:2, src/fallback.ts:8:3, src/last.ts:6:4, \`${files.absolute}:9:5\`.`,
  ].join('\n\n');
  const message = (id: string, content: unknown[], stop_reason: string) => ({
    ...envelope, type: 'assistant', message: { id, type: 'message', role: 'assistant', model: 'fake-claude', content, stop_reason,
      stop_sequence: null, usage: { input_tokens: 1, output_tokens: 5 } },
  });
  return { turns: [[
    { event: { ...envelope, type: 'system', subtype: 'init', cwd: '$CWD', tools: toolNames, model: 'fake-claude', permissionMode: 'default', apiKeySource: 'none' } },
    ...toolNames.flatMap((name, i) => [
      { event: message(`msg_tool_34_${i}`, [{ type: 'tool_use', id: `tool_34_${i}`, name, input: toolInputs[i] }], 'tool_use') },
      { event: { ...envelope, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool_34_${i}`, content: 'Invented file operation complete.', is_error: false }] } } },
    ]),
    { event: message('msg_reply_34', [{ type: 'text', text }], 'end_turn') },
    { event: { ...envelope, type: 'result', subtype: 'success', is_error: false, result: text, errors: [], duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 5 } } },
  ]] };
}

export const test = base.extend<{ files: Files }>({
  files: [async ({}, use) => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'cod-story-34-')));
    const folders = ['orchard', 'harbor', 'meadow'].map(name => path.join(directory, name));
    const files = { directory, folders, outside: path.join(directory, 'outside.ts'), absolute: path.join(folders[2], 'src/absolute.ts') };
    const fake = path.join(directory, 'fake');
    mkdirSync(path.join(fake, 'scenarios'), { recursive: true });
    // Copy the real scripted CLI protocol runner, without changing shared files.
    cpSync(path.join(root, 'tests/fakes/claude/claude'), path.join(fake, 'claude'));
    cpSync(path.join(root, 'tests/fakes/claude/mcp-client.cjs'), path.join(fake, 'mcp-client.cjs'));
    mkdirSync(path.join(directory, 'claude-config'));
    mkdirSync(path.join(directory, 'gates'));
    const overrides: Record<string, string | undefined> = {
      COD_CLAUDE_BIN: path.join(fake, 'claude'), COD_FAKE_CLAUDE_SCENARIO: 'story-34',
      COD_FAKE_CLAUDE_LOG: path.join(directory, 'claude.jsonl'), COD_FAKE_CLAUDE_GATES: path.join(directory, 'gates'),
      COD_TEST_PICK_FOLDERS: JSON.stringify(folders.map(folder => [folder])),
      CLAUDE_CONFIG_DIR: path.join(directory, 'claude-config'),
    };
    for (const name of Object.keys(process.env)) {
      if (/^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name)) overrides[name] = undefined;
    }
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    try {
      for (const [i, folder] of folders.entries()) {
        mkdirSync(path.join(folder, 'src'), { recursive: true });
        writeFileSync(path.join(folder, 'src/shared.ts'), contents(`root${i}`));
        if (i > 0) writeFileSync(path.join(folder, 'src/fallback.ts'), contents(`fallback${i}`));
        execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder]);
      }
      for (const name of ['a', 'read', 'edit', 'multi', 'write']) writeFileSync(path.join(folders[0], `src/${name}.ts`), contents(name));
      // Replay successful edits against their on-disk post-operation contents.
      writeFileSync(path.join(folders[0], 'src/edit.ts'), contents('edit').replace('// edit line 07 abcdefghijklmnop', '// edit line 07 CHANGED'));
      writeFileSync(path.join(folders[0], 'src/multi.ts'), contents('multi')
        .replace('// multi line 15 abcdefghijklmnop', '// multi line 15 CHANGED')
        .replace('// multi line 04 abcdefghijklmnop', '// multi line 04 CHANGED'));
      writeFileSync(path.join(folders[2], 'src/last.ts'), contents('last'));
      writeFileSync(files.absolute, contents('absolute'));
      writeFileSync(files.outside, contents('outside'));
      writeFileSync(path.join(fake, 'scenarios/story-34.json'), JSON.stringify(scenario(files), null, 2));
      for (const [name, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      await use(files);
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});

export async function prepare(page: Page, files: Files) {
  // #29 removes Add Folder and adds the keyboard command. Use its start screen
  // as the version signal, before opening the chat changes visible state.
  const startScreen = await page.getByTestId('start-screen').isVisible();
  if (startScreen) await page.keyboard.press(`${modifier}+n`);
  await expect(chat(page)).toBeVisible();
  for (const [i, folder] of files.folders.entries()) {
    if (startScreen) await page.keyboard.press(`${modifier}+Shift+a`);
    else {
      const panel = page.getByTestId('project-panel');
      if (!await panel.isVisible()) await page.keyboard.press(`${modifier}+Shift+e`);
      await panel.getByTestId('project-add-folder').focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('project-root')).toHaveCount(i + 1);
    await expect(page.getByTestId('project-root').nth(i)).toHaveAttribute('data-path', folder);
  }
  await expect(chat(page)).toBeVisible();
  await expect(chat(page).getByTestId('chat-working-directory')).toContainText(files.folders[0]);
  await composer(page).focus();
  await page.keyboard.insertText('Show the invented file operations and file mentions.');
  await page.keyboard.press('Enter');
  await expect(reply(page)).toHaveAttribute('data-state', 'complete');
  await expect(reply(page)).toContainText('Resolution:');
  await expect(chat(page).getByTestId('chat-tool-call')).toHaveCount(4);
}

export async function expectOpen(page: Page, file: string, line?: number, column = 1) {
  const active = page.getByTestId('workspace-area').getByRole('tab', { selected: true });
  await expect(active, 'Story #34 file link must open the requested file in the editor').toHaveAttribute('data-path', file);
  const editor = page.getByTestId('workspace-area').getByTestId('editor-content');
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  if (line !== undefined) {
    // Observe the browser's caret in the real contenteditable DOM. No CM state,
    // renderer API or layout class is used. All small fixture lines are rendered.
    await expect.poll(() => editor.evaluate(element => {
      const selection = window.getSelection();
      if (!selection?.anchorNode || !selection.isCollapsed || !element.contains(selection.anchorNode)) return null;
      let row: Node = selection.anchorNode;
      while (row.parentNode && row.parentNode !== element) row = row.parentNode;
      const index = Array.from(element.childNodes).indexOf(row as ChildNode);
      const range = document.createRange();
      range.setStart(row, 0);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return { line: index + 1, column: range.toString().length + 1 };
    }), { message: 'Story #34 file link must place the caret at the requested line and column' }).toEqual({ line, column });
  }
}

export async function tabTo(page: Page, link: Locator, direction: 'Tab' | 'Shift+Tab', from: Locator) {
  const history = chat(page).getByRole('log', { name: 'Conversation' });
  // Enter focuses the editor. Restore the transcript boundary or previous link
  // before continuing in order, without passing through the composer.
  await from.focus();
  await expect(from).toBeFocused();
  await expect.poll(() => history.evaluate(element => element.contains(document.activeElement)), {
    message: 'Story #34 keyboard navigation must start in the chat history',
  }).toBe(true);
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(direction);
    await expect.poll(() => history.evaluate(element => element.contains(document.activeElement)), {
      message: `Story #34 file links must be reachable in order with ${direction} within the chat history`,
    }).toBe(true);
    if (await link.evaluate(element => element === document.activeElement)) return;
  }
  await expect(link, `Story #34 file link must be reachable with ${direction}`).toBeFocused();
}
