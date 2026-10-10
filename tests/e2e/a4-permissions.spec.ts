import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, root } from './helpers/electron';

const command = 'printf cod-permission-fixture';
const request = { tool_name: 'Bash', input: { command } };
const credential = /^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i;
type RecordLine = {
  kind: string; tool?: string; localTool?: string; request?: typeof request;
  answer?: { behavior: string; updatedInput?: typeof request.input; message?: string };
  argv?: string[]; line?: string; transport?: string; tool_name?: string; input?: typeof request.input;
};
type Fake = { records: () => RecordLine[] };
const test = base.extend<{ fake: Fake }>({
  fake: [async ({}, use, testInfo) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cod-story-9-'));
    const log = path.join(directory, 'claude.jsonl');
    const gates = path.join(directory, 'gates');
    mkdirSync(gates);
    const overrides: Record<string, string | undefined> = {
      COD_CLAUDE_BIN: path.join(root, 'tests/fakes/claude/claude'),
      COD_FAKE_CLAUDE_LOG: log,
      COD_FAKE_CLAUDE_GATES: gates,
      COD_FAKE_CLAUDE_SCENARIO: 'permissions',
    };
    for (const name of Object.keys(process.env)) if (credential.test(name)) overrides[name] = undefined;
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const records = () => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine) : [];
    try { await use({ records }); }
    finally {
      // Invented inputs only. Preserve evidence before deleting the isolated fixture.
      if (existsSync(log)) await testInfo.attach('permission-protocol-log', { body: readFileSync(log), contentType: 'application/x-ndjson' });
      for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});

const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
const prompt = (page: Page) => chat(page).getByTestId('chat-permission-prompt');
const status = (page: Page) => chat(page).getByTestId('chat-session-status');
const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');
const once = (page: Page) => prompt(page).getByRole('button', { name: 'Allow once', exact: true });
const session = (page: Page) => prompt(page).getByRole('button', { name: 'Allow for this session', exact: true });
const deny = (page: Page) => prompt(page).getByRole('button', { name: 'Deny', exact: true });
async function send(page: Page) {
  await expect(chat(page), 'Prerequisite story #8 chat is missing; this is not the #9 red baseline').toBeVisible();
  await chat(page).getByRole('textbox', { name: 'Message Claude' }).focus();
  await page.keyboard.insertText('Run the invented permission fixture command');
  await page.keyboard.press('Enter');
}
async function pending(page: Page) {
  await send(page);
  await expect(prompt(page), 'Story #9 permission prompt is missing: the pending MCP request must be answerable in the chat').toBeVisible();
}
async function answer(fake: Fake, index: number, behavior: string) {
  await expect.poll(() => fake.records().filter(record => record.kind === 'permission-answer')[index]?.answer?.behavior,
    { message: 'The answer must reach the fake through the MCP tools/call result' }).toBe(behavior);
  return fake.records().filter(record => record.kind === 'permission-answer')[index];
}
async function allowed(page: Page, fake: Fake, index = 0) {
  const record = await answer(fake, index, 'allow');
  expect(record.request).toEqual(request);
  expect(record.answer).toEqual({ behavior: 'allow', updatedInput: request.input });
  await expect(replies(page).last()).toHaveText('Allowed command complete.');
  await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
  await expect(prompt(page)).toBeHidden();
  await expect(status(page)).not.toHaveText(/needs input/i);
}

test('AC1: pending permission shows tool, command, three choices and needs input status', async ({ cod: { page }, fake }, testInfo) => {
  await pending(page);
  await expect(prompt(page)).toContainText('Bash');
  await expect(prompt(page)).toContainText(command);
  for (const button of [once(page), session(page), deny(page)]) await expect(button).toBeVisible();
  await expect(status(page)).toHaveText(/needs input/i);
  expect(fake.records().filter(record => record.kind === 'tool-run')).toHaveLength(0);
  expect(fake.records().filter(record => record.kind === 'permission-answer')).toHaveLength(0);
  await testInfo.attach('pending-permission-look-check', { body: await page.screenshot(), contentType: 'image/png' });
});

test('AC2: focused prompt Enter allows once and an identical next request prompts again', async ({ cod: { page }, fake }) => {
  await pending(page);
  await expect(once(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await allowed(page, fake);
  await pending(page);
  await expect(status(page)).toHaveText(/needs input/i);
  expect(fake.records().filter(record => record.kind === 'permission-answer')).toHaveLength(1);
  await page.keyboard.press('Enter');
  await allowed(page, fake, 1);
});

test('AC2: documented S key allows this session and identical second request does not prompt', async ({ cod: { page }, fake }) => {
  await pending(page);
  await expect(session(page)).toHaveAttribute('aria-keyshortcuts', 'S');
  await expect(prompt(page)).toContainText(/\bS\b/);
  await page.keyboard.press('s');
  await allowed(page, fake);
  // Observe the whole next turn from before submission until the reply completes.
  // A transient prompt is a failure even if it disappears before the final assertion.
  await page.evaluate(() => {
    const state = window as unknown as { permissionPromptSeen: boolean; permissionObserver: MutationObserver };
    state.permissionPromptSeen = false;
    const sample = () => {
      for (const element of document.querySelectorAll('[data-testid="workspace-area"] [data-testid="chat-permission-prompt"]')) {
        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height && getComputedStyle(element).visibility !== 'hidden') state.permissionPromptSeen = true;
      }
    };
    state.permissionObserver = new MutationObserver(sample);
    state.permissionObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  await send(page);
  await expect(replies(page)).toHaveCount(2);
  await allowed(page, fake, 1);
  const seen = await page.evaluate(() => {
    const state = window as unknown as { permissionPromptSeen: boolean; permissionObserver: MutationObserver };
    state.permissionObserver.disconnect(); return state.permissionPromptSeen;
  });
  expect(seen, 'An identical second request must be answered without another visible prompt').toBe(false);
  const requests = fake.records().filter(record => record.kind === 'permission-request');
  expect(requests).toHaveLength(2);
  expect(requests.map(record => record.request)).toEqual([request, request]);
});

test('AC2: Esc selects denial instead of interrupting the Claude process', async ({ cod: { page }, fake }) => {
  await pending(page);
  await expect(once(page)).toBeFocused();
  await page.keyboard.press('Escape');
  const reason = prompt(page).getByRole('textbox', { name: 'Denial reason', exact: true });
  await expect(reason).toBeFocused();
  await page.keyboard.insertText('Keep this command blocked');
  await page.keyboard.press('Enter');
  await answer(fake, 0, 'deny');
  await expect(replies(page).last()).toHaveText('Denied command: Keep this command blocked');
  expect(fake.records().filter(record => record.kind === 'signal')).toHaveLength(0);
  expect(fake.records().filter(record => record.kind === 'tool-run')).toHaveLength(0);
});

test('AC2: Tab and arrows move through choices and Enter activates the focused choice', async ({ cod: { page }, fake }) => {
  await pending(page);
  await expect(once(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(session(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(deny(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(session(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(deny(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(session(page)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(once(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(session(page)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await allowed(page, fake);
});

test('AC2: all three permission choices work by clicking', async ({ cod: { page }, fake }) => {
  await pending(page);
  await once(page).click();
  await allowed(page, fake);
  await pending(page);
  await deny(page).click();
  await prompt(page).getByRole('textbox', { name: 'Denial reason', exact: true }).fill('Click denial');
  await prompt(page).getByRole('button', { name: 'Send denial', exact: true }).click();
  await answer(fake, 1, 'deny');
  await expect(replies(page).last()).toHaveText('Denied command: Click denial');
  await pending(page);
  await session(page).click();
  await allowed(page, fake, 2);
});

test('AC3: denial reason is sent unchanged to Claude through the MCP answer', async ({ cod: { page }, fake }) => {
  await pending(page);
  await page.keyboard.press('Escape');
  await expect(prompt(page).getByRole('textbox', { name: 'Denial reason', exact: true })).toBeFocused();
  const reason = 'Do not run "printf"; keep the fixture unchanged.';
  await page.keyboard.insertText(reason);
  await page.keyboard.press('Enter');
  const record = await answer(fake, 0, 'deny');
  expect(record.request).toEqual(request);
  expect(record.answer).toEqual({ behavior: 'deny', message: reason });
  await expect(replies(page).last()).toHaveText(`Denied command: ${reason}`);
});

for (const behavior of ['allow', 'deny']) test(`AC4: MCP ${behavior} answer reaches Claude and the transcript shows its reaction`, async ({ cod: { page }, fake }) => {
  await pending(page);
  if (behavior === 'allow') {
    await page.keyboard.press('Enter');
    await allowed(page, fake);
    expect(fake.records().filter(record => record.kind === 'tool-run')).toEqual([
      expect.objectContaining({ tool_name: 'Bash', input: request.input }),
    ]);
    await expect(chat(page).getByTestId('chat-tool-call').getByRole('button', { name: /Bash.*cod-permission-fixture/ })).toBeVisible();
  } else {
    await page.keyboard.press('Escape');
    await expect(prompt(page).getByRole('textbox', { name: 'Denial reason', exact: true })).toBeFocused();
    await page.keyboard.insertText('User declined the command');
    await page.keyboard.press('Enter');
    const record = await answer(fake, 0, 'deny');
    expect(record.answer).toEqual({ behavior: 'deny', message: 'User declined the command' });
    await expect(replies(page).last()).toHaveText('Denied command: User declined the command');
    await expect(replies(page).last()).toHaveAttribute('data-state', 'complete');
    await expect(prompt(page)).toBeHidden();
    await expect(status(page)).not.toHaveText(/needs input/i);
    expect(fake.records().filter(record => record.kind === 'tool-run')).toHaveLength(0);
    await expect(chat(page).getByTestId('chat-tool-call')).toHaveCount(0);
  }
});

test('AC5: configured local MCP permission tool receives request and answers without stdio control messages', async ({ cod: { page }, fake }) => {
  await pending(page);
  const start = fake.records().find(record => record.kind === 'start')!;
  expect(start.argv).toEqual(expect.arrayContaining(['--permission-prompt-tool', '--mcp-config']));
  expect(start.argv).not.toEqual(expect.arrayContaining(['--dangerously-skip-permissions']));
  const tool = start.argv![start.argv!.indexOf('--permission-prompt-tool') + 1];
  const sent = fake.records().find(record => record.kind === 'permission-request')!;
  expect(sent).toMatchObject({ tool, request });
  expect(fake.records().find(record => record.kind === 'mcp-connect')?.transport).toMatch(/^(stdio|http)$/);
  await page.keyboard.press('Enter');
  await allowed(page, fake);
  expect(fake.records().find(record => record.kind === 'permission-answer')).toMatchObject({ tool, request, answer: { behavior: 'allow', updatedInput: request.input } });
  const stdin = fake.records().filter(record => record.kind === 'stdin').map(record => JSON.parse(record.line!));
  expect(stdin).toHaveLength(1);
  expect(stdin[0]).toMatchObject({ type: 'user', message: { role: 'user', content: 'Run the invented permission fixture command' } });
  expect(fake.records().filter(record => record.kind === 'error' || record.kind === 'permission-host-missing')).toHaveLength(0);
});
