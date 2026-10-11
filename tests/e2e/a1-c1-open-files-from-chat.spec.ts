import { test, toolNames, chat, composer, reply, prepare, expectOpen, tabTo } from './helpers/chat-files-34';
import { expect } from './helpers/electron';
import path from 'node:path';

test('AC1: Read, Edit, MultiEdit and Write paths open files, with edits at the first changed line', async ({ cod: { page }, files }) => {
  await prepare(page, files);
  const names = ['read', 'edit', 'multi', 'write'];
  for (const [i, toolName] of toolNames.entries()) {
    const row = chat(page).getByTestId('chat-tool-call').nth(i);
    await expect(row).toContainText(toolName);
    const target = `src/${names[i]}.ts`;
    const link = row.getByRole('link', { name: target, exact: true });
    await expect(link, `Story #34 ${toolName} file_path must be a clickable link in the tool row`).toBeVisible();
    await link.click();
    await expectOpen(page, path.join(files.folders[0], target), i === 1 ? 7 : i === 2 ? 4 : undefined);
  }
});

test('AC2: plain and inline-code file mentions link to the file, line and column', async ({ cod: { page }, files }) => {
  await prepare(page, files);
  for (const [name, line, column] of [['src/a.ts', undefined, undefined], ['src/a.ts:12', 12, 1], ['src/a.ts:12:5', 12, 5]] as const) {
    const links = reply(page).getByRole('link', { name, exact: true });
    await expect(links, `Story #34 ${name} must link in both plain text and inline code`).toHaveCount(2);
    for (let variant = 0; variant < 2; variant++) {
      await links.nth(variant).click();
      await expectOpen(page, path.join(files.folders[0], 'src/a.ts'), line, column);
    }
  }
});

test('AC3: missing and outside-folder paths remain text while existing file mentions are links', async ({ cod: { page }, files }) => {
  await prepare(page, files);
  // A positive control makes the unimplemented link feature fail this criterion.
  await expect(reply(page).getByRole('link', { name: 'src/a.ts', exact: true }), 'Story #34 existing-file control must be linked before testing non-links').toHaveCount(2);
  for (const name of ['src/missing.ts', 'src/missing.ts:12', 'src/missing.ts:12:5', files.outside, `${files.outside}:12:5`, '../outside.ts']) {
    await expect(reply(page)).toContainText(name);
    await expect(reply(page).getByRole('link', { name, exact: true }), `Story #34 unavailable or outside file ${name} must not be linked`).toHaveCount(0);
  }
  await expect(page.getByTestId('editor-tab')).toHaveCount(0);
});

test('AC4: Tab and Shift+Tab reach tool and reply file links and Enter opens their targets', async ({ cod: { page }, files }) => {
  await prepare(page, files);
  const targets = [
    ...['read', 'edit', 'multi', 'write'].map((name, i) => ({
      link: chat(page).getByTestId('chat-tool-call').nth(i).getByRole('link', { name: `src/${name}.ts`, exact: true }),
      file: path.join(files.folders[0], `src/${name}.ts`), line: i === 1 ? 7 : i === 2 ? 4 : undefined, column: 1,
    })),
    ...[0, 1].map(i => ({ link: reply(page).getByRole('link', { name: 'src/a.ts:12:5', exact: true }).nth(i),
      file: path.join(files.folders[0], 'src/a.ts'), line: 12, column: 5 })),
  ];
  for (const direction of ['Tab', 'Shift+Tab'] as const) {
    for (const target of targets) {
      await expect(target.link, 'Story #34 file links must exist before exercising keyboard navigation').toBeVisible();
      await composer(page).focus();
      await tabTo(page, target.link, direction);
      await page.keyboard.press('Enter');
      await expectOpen(page, target.file, target.line, target.column);
    }
  }
});

test('AC5: resolution prefers the chat folder, searches workspace folders in order and accepts in-folder absolute paths', async ({ cod: { page }, files }) => {
  await prepare(page, files);
  const targets = [
    { name: 'src/shared.ts:3:2', file: path.join(files.folders[0], 'src/shared.ts'), line: 3, column: 2 },
    { name: 'src/fallback.ts:8:3', file: path.join(files.folders[1], 'src/fallback.ts'), line: 8, column: 3 },
    { name: 'src/last.ts:6:4', file: path.join(files.folders[2], 'src/last.ts'), line: 6, column: 4 },
    { name: `${files.absolute}:9:5`, file: files.absolute, line: 9, column: 5 },
  ];
  for (const target of targets) {
    const link = reply(page).getByRole('link', { name: target.name, exact: true });
    await expect(link, `Story #34 ${target.name} must resolve against the chat and workspace folders`).toBeVisible();
    await link.click();
    await expectOpen(page, target.file, target.line, target.column);
  }
});
