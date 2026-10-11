import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, root } from './electron';

export type Question = {
  header: string; question: string; multiSelect: boolean;
  options: { label: string; description: string }[];
};
type Request = { tool_name: string; input: { questions: Question[] } };
type RecordLine = {
  kind: string; request?: Request;
  answer?: { behavior: string; message?: string; updatedInput?: { questions: Question[]; answers?: Record<string, string | string[]> } };
};
export type Fake = { records: () => RecordLine[]; requests: Request[] };
export const test = base.extend<{ questionFake: Fake; questionScenario: string }>({
  questionScenario: ['ask-user-question-keyboard', { option: true }],
  questionFake: [async ({ questionScenario }, use, testInfo) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cod-story-32-'));
    const config = path.join(directory, 'claude-config');
    const gates = path.join(directory, 'gates');
    mkdirSync(config);
    mkdirSync(gates);
    const log = path.join(directory, 'claude.jsonl');
    const scenario = JSON.parse(readFileSync(path.join(root, 'tests/fakes/claude/scenarios', `${questionScenario}.json`), 'utf8')) as { turns: { permission?: Request }[][] };
    const requests = scenario.turns.map(turn => turn.find(step => step.permission)!.permission!);
    const overrides: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: config,
      COD_CLAUDE_BIN: path.join(root, 'tests/fakes/claude/claude'),
      COD_FAKE_CLAUDE_LOG: log,
      COD_FAKE_CLAUDE_GATES: gates,
      COD_FAKE_CLAUDE_SCENARIO: questionScenario,
    };
    for (const name of Object.keys(process.env)) {
      if (/^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name)) overrides[name] = undefined;
    }
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const records = () => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordLine) : [];
    try { await use({ records, requests }); }
    finally {
      if (existsSync(log)) await testInfo.attach('ask-user-question-protocol', { body: readFileSync(log), contentType: 'application/x-ndjson' });
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});

export { expect };
export const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
export const form = (page: Page) => chat(page).getByTestId('chat-question-form');
export const group = (page: Page, question: Question) => form(page).getByRole('group', { name: question.question, exact: true });
export const option = (page: Page, question: Question, label: string) => group(page, question).getByRole(question.multiSelect ? 'checkbox' : 'radio', { name: label, exact: true });
export const submit = (page: Page) => form(page).getByRole('button', { name: 'Submit', exact: true });
export const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');

export async function pending(page: Page, fake: Fake, index = 0) {
  if (await page.getByTestId('start-screen').isVisible()) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
  }
  await expect(chat(page), 'Prerequisite Claude chat must be available before testing #32').toBeVisible();
  await chat(page).getByRole('textbox', { name: 'Message Claude', exact: true }).focus();
  await page.keyboard.insertText('Ask about the invented fixture sizes');
  await page.keyboard.press('Enter');
  await expect.poll(() => fake.records().filter(record => record.kind === 'permission-request')[index]?.request,
    { message: 'Prerequisite fake AskUserQuestion request must reach the real MCP permission host' }).toEqual(fake.requests[index]);
  await expect(form(page), 'Story #32 question UI is missing: AskUserQuestion must show answerable questions instead of a raw permission prompt').toBeVisible();
}

export async function response(fake: Fake, index = 0) {
  await expect.poll(() => fake.records().filter(record => record.kind === 'permission-answer').length).toBe(index + 1);
  return fake.records().filter(record => record.kind === 'permission-answer')[index]!;
}

export async function chooseFirstAndSubmit(page: Page, questions: Question[]) {
  for (const question of questions) {
    await expect(option(page, question, question.options[0]!.label)).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(submit(page)).toBeFocused();
  await page.keyboard.press('Enter');
}
