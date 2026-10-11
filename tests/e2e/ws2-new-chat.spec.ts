import { test, expect, chat, composer, openInitialChat, replaceChat, send, starts, modifier, type Fixture } from './helpers/new-chat';

async function checkDirectory(fixture: Fixture, expected: string): Promise<void> {
  await expect(chat(fixture.page).getByTestId('chat-working-directory')).toContainText(expected);
  await send(fixture.page, 'Identify this invented working folder');
  await expect.poll(() => starts(fixture).at(-1)?.cwd, { message: 'Claude start log must show the chosen working folder' }).toBe(expected);
  expect(starts(fixture).at(-1)?.argv).not.toContain('--resume');
}

// Exactly one Playwright test per criterion. Alternative settings inputs are
// sequential isolated launches inside that criterion's test.
test('AC1: Cmd-N starts Claude in the first workspace folder and shows it in the header', async ({ run }) => {
  await run('default', async fixture => {
    const { page } = fixture;
    const hasStartScreen = await page.getByTestId('start-screen').isVisible();
    await openInitialChat(page);
    await page.keyboard.press(`${modifier}+Shift+e`);
    const panel = page.getByTestId('project-panel');
    await expect(panel).toBeVisible();
    for (const [index, folder] of fixture.folders.entries()) {
      if (hasStartScreen) await page.keyboard.press(`${modifier}+Shift+a`);
      else {
        // Before #29 the only folder entry is the project-panel button.
        await panel.getByTestId('project-add-folder').focus();
        await page.keyboard.press('Enter');
      }
      await expect(panel.getByTestId('project-root')).toHaveCount(index + 1);
      await expect(panel.getByTestId('project-root').nth(index)).toHaveAttribute('data-path', folder);
    }
    await send(page, 'Old workspace conversation');
    await replaceChat(page);
    await checkDirectory(fixture, fixture.folders[0]);
    await expect(chat(page).getByTestId('chat-working-directory')).not.toContainText(fixture.folders[1]);
    await expect(chat(page).getByTestId('chat-working-directory')).not.toContainText(fixture.defaultFolder);
  });
});

test('AC2: an empty workspace starts Claude in the JSONC default_chat_folder and shows it', async ({ run }) => {
  await run('default', async fixture => {
    await openInitialChat(fixture.page);
    await send(fixture.page, 'Old default-folder conversation');
    await replaceChat(fixture.page);
    await checkDirectory(fixture, fixture.defaultFolder);
  });
});

test('AC3: an empty workspace without settings or without the key starts Claude at home', async ({ run }) => {
  for (const settings of ['absent', 'no-key'] as const) {
    await run(settings, async fixture => {
      await openInitialChat(fixture.page);
      await send(fixture.page, `Old home conversation with ${settings}`);
      await replaceChat(fixture.page);
      await checkDirectory(fixture, fixture.home);
    });
  }
});

test('AC4: Cmd-N clears history, starts without resume and preserves the old CLI session', async ({ run }) => {
  await run('absent', async fixture => {
    const { page } = fixture;
    await openInitialChat(page);
    await send(page, 'Remember the old invented conversation');
    const sessionHeader = chat(page).getByTestId('chat-session-id');
    await expect(sessionHeader).toBeVisible();
    const oldSession = (await sessionHeader.innerText()).trim();
    expect(oldSession).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(fixture.records().find(record => record.kind === 'turn')?.session_id).toBe(oldSession);
    await replaceChat(page);
    await expect(composer(page)).toHaveValue('');
    await send(page, 'Start a fresh invented conversation');
    expect(starts(fixture)).toHaveLength(2);
    expect(starts(fixture)[1].argv).not.toContain('--resume');
    const newSession = (await sessionHeader.innerText()).trim();
    expect(newSession).not.toBe(oldSession);
    const turns = fixture.records().filter(record => record.kind === 'turn');
    expect(turns[1].session_id).toBe(newSession);
    expect(turns[1].history).toEqual(['Start a fresh invented conversation']);
    const resumed = await fixture.resume(oldSession);
    expect(resumed.stderr).toBe('');
    expect(resumed.code).toBe(0);
    const events = resumed.stdout.trim().split('\n').map(line => JSON.parse(line) as { type: string; session_id?: string });
    expect(events.find(event => event.type === 'result')?.session_id).toBe(oldSession);
    const resumedTurn = fixture.records().filter(record => record.kind === 'turn').at(-1)!;
    expect(resumedTurn.session_id).toBe(oldSession);
    expect(resumedTurn.history).toEqual(['Remember the old invented conversation', 'Resume the old invented conversation']);
  });
});

test('AC5: invalid JSON or a missing default folder falls back home with a one-line problem notice', async ({ run }) => {
  for (const settings of ['invalid-json', 'missing-folder'] as const) {
    await run(settings, async fixture => {
      const { page } = fixture;
      await openInitialChat(page);
      await send(page, `Old fallback conversation with ${settings}`);
      await replaceChat(page);
      const notice = chat(page).getByTestId('chat-folder-notice');
      await expect(notice, 'Story #30: invalid chat settings must produce a visible one-line problem notice').toBeVisible();
      const text = (await notice.innerText()).trim();
      expect(text).not.toMatch(/[\r\n]/);
      if (settings === 'invalid-json') {
        expect(text).toMatch(/(?:invalid|parse|syntax|malformed).*JSON|JSON.*(?:invalid|parse|syntax|malformed)/i);
        expect(text).toContain('settings.json');
      } else {
        expect(text).toContain(fixture.missingFolder);
        expect(text).toMatch(/(?:not exist|doesn't exist|missing|not found|no such)/i);
      }
      await checkDirectory(fixture, fixture.home);
    });
  }
});
