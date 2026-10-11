import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, root } from './helpers/electron';
import { test, languages, linkURL, longCode, longPath, longURL, sentence, streamChunks, unsafeHTML } from './fixtures/31-markdown';

declare global {
  interface Window {
    __story31Executed?: boolean;
    __story31Layout?: { samples: number; violations: string[]; stop: boolean };
  }
}

const chat = (page: Page) => page.getByTestId('workspace-area').getByTestId('claude-chat');
const replies = (page: Page) => chat(page).getByTestId('chat-assistant-message');
async function send(page: Page, prompt = 'Show the invented markdown fixture') {
  const composer = chat(page).getByRole('textbox', { name: 'Message Claude' });
  await composer.focus();
  await page.keyboard.insertText(prompt);
  await page.keyboard.press('Enter');
  await expect(chat(page).getByTestId('chat-user-message').last()).toHaveText(prompt);
}
async function complete(page: Page) {
  const reply = replies(page).last();
  await expect(reply).toHaveAttribute('data-state', 'complete');
  await expect(chat(page).getByTestId('chat-session-status')).toHaveText('Ready');
  return reply;
}
async function narrow(page: Page) {
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(900);
}
async function contained(page: Page) {
  const metrics = await chat(page).evaluate(element => {
    const history = element.querySelector('[role="log"]') as HTMLElement;
    const edge = history.getBoundingClientRect().right;
    return {
      historyOverflow: history.scrollWidth - history.clientWidth,
      paneRight: element.getBoundingClientRect().right,
      windowWidth: window.innerWidth,
      outside: [...history.children].filter(child => child.getBoundingClientRect().right > edge + 1).length,
    };
  });
  expect(metrics.historyOverflow, 'Chat history must have no horizontal overflow').toBeLessThanOrEqual(1);
  expect(metrics.paneRight, 'Chat pane must fit the 900 px window').toBeLessThanOrEqual(metrics.windowWidth + 1);
  expect(metrics.outside, 'Messages and tools must stay inside the history right edge').toBe(0);
}
async function scrollsInside(content: Locator) {
  const metrics = await content.evaluate(element => {
    const history = element.closest('[role="log"]')!;
    let box: HTMLElement | null = element as HTMLElement;
    while (box && box !== history) {
      if (/^(auto|scroll)$/.test(getComputedStyle(box).overflowX) && box.scrollWidth > box.clientWidth + 1) {
        box.scrollLeft = 80;
        return { scrolled: box.scrollLeft > 0, right: box.getBoundingClientRect().right, historyRight: history.getBoundingClientRect().right };
      }
      box = box.parentElement;
    }
    return null;
  });
  expect(metrics, 'Wide content must have its own horizontal scroll box before the chat history').not.toBeNull();
  expect(metrics!.scrolled, 'The local box must actually scroll horizontally').toBe(true);
  expect(metrics!.right).toBeLessThanOrEqual(metrics!.historyRight + 1);
}

test('AC1: prose, 200-character words and long tool targets fit a 900 px chat; only code scrolls', async ({ cod: { app, page } }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 700));
  await narrow(page);
  await send(page);
  const reply = await complete(page);
  await expect(reply).toContainText(longPath);
  await expect(reply).toContainText(longURL);
  await expect(chat(page).getByTestId('chat-tool-call').getByRole('button', { name: /Read/ })).toContainText(longPath);
  await contained(page);
  const prose = reply.locator('p').filter({ hasText: sentence });
  await expect(prose).toHaveCount(1);
  const wraps = await prose.evaluate(element => element.getBoundingClientRect().height > parseFloat(getComputedStyle(element).lineHeight) * 2);
  expect(wraps, 'Long sentences must occupy multiple lines').toBe(true);
  const code = reply.locator('pre');
  await expect(code).toContainText(longCode);
  await scrollsInside(code);
});

test('AC3: GFM tables have header cells and wide tables scroll inside their own box', async ({ cod: { app, page } }, testInfo) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 700));
  await narrow(page);
  await send(page);
  const reply = await complete(page);
  const tables = reply.getByRole('table');
  await expect(tables, 'GFM pipe syntax must render as two tables').toHaveCount(2);
  await expect(tables.first().getByRole('columnheader')).toHaveText(['Name', 'Status']);
  await expect(tables.first().locator('thead > tr > th')).toHaveCount(2);
  await expect(tables.first().getByRole('cell')).toHaveText(['Orchard', 'Ready']);
  await expect(tables.last().getByRole('columnheader')).toHaveCount(12);
  await expect(reply).not.toContainText('| --- |');
  await contained(page);
  await scrollsInside(tables.last());
  await testInfo.attach('markdown-tables', { body: await page.screenshot(), contentType: 'image/png' });
});

test('AC4: all seven fenced languages use editor theme token colors and inline code is a span', async ({ cod: { page } }, testInfo) => {
  await send(page);
  const reply = await complete(page);
  const blocks = reply.locator('pre > code');
  await expect(blocks, 'Every fenced language must render as pre > code with highlighted tokens').toHaveCount(7);
  const theme = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/zed-themes/one.json'), 'utf8'));
  const syntax = theme.themes.find((entry: { name: string }) => entry.name === 'One Dark').style.syntax;
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;
  const keywordColor = rgb(syntax.keyword.color);
  const stringColor = rgb(syntax.string.color);
  expect(keywordColor).not.toBe(stringColor);
  for (const [index, language] of languages.entries()) {
    const block = blocks.nth(index);
    await expect(block).toHaveText(language.text + '\n');
    // Check the actual painted characters rather than a renderer-specific token class.
    const painted = await block.evaluate((element, probes) => {
      const text = element.textContent!;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const colors: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const color = getComputedStyle(node.parentElement!).color;
        colors.push(...Array(node.textContent!.length).fill(color));
      }
      return probes.map(probe => {
        const start = text.indexOf(probe);
        return start < 0 ? [] : [...new Set(colors.slice(start, start + probe.length))];
      });
    }, [language.keyword, language.string]);
    // JSON has a boolean literal rather than a keyword. Its editor category is boolean.
    const expectedKeyword = language.tag === 'json' ? rgb(syntax.boolean.color) : keywordColor;
    expect(painted[0], `${language.tag} keyword/literal must use its editor theme color`).toEqual([expectedKeyword]);
    expect(painted[1], `${language.tag} string must use the editor string color`).toEqual([stringColor]);
    expect(painted[0]).not.toEqual(painted[1]);
  }
  const inline = reply.locator('code').filter({ hasText: /^value$/ });
  await expect(inline).toHaveCount(1);
  expect(await inline.evaluate(element => element.closest('pre') === null), 'Inline code must not be a fenced block').toBe(true);
  await expect(reply).not.toContainText('`value`');
  await testInfo.attach('markdown-highlighted-code', { body: await page.screenshot(), contentType: 'image/png' });
});

test('AC5: clicking a reply link records a system-browser handoff without navigating Cod', async ({ cod: { app, page } }) => {
  await send(page);
  const reply = await complete(page);
  const link = reply.getByRole('link', { name: 'Read the reference', exact: true });
  await expect(link, 'Markdown links must be real accessible links').toBeVisible();
  await expect(link).toHaveAttribute('href', linkURL);
  const originalURL = page.url();
  const originalWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const navigations: string[] = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await link.click();
  await expect.poll(() => app.evaluate(() => {
    return (globalThis as typeof globalThis & { __codTestOpenedExternalURLs?: string[] }).__codTestOpenedExternalURLs ?? [];
  }), { message: 'The main process must record the URL handed to the system browser' }).toEqual([linkURL]);
  expect(navigations, 'Clicking an external link must not navigate the Cod main frame').toEqual([]);
  expect(page.url()).toBe(originalURL);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(originalWindows);
  await expect(chat(page).getByRole('textbox', { name: 'Message Claude' })).toBeVisible();
  await expect(reply).toHaveAttribute('data-state', 'complete');
});

test('AC6: unfinished streamed fences keep layout intact and finish like a complete reply', async ({ cod: { app, page }, markdownFake }, testInfo) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 700));
  await narrow(page);
  await chat(page).evaluate(element => {
    const state = window.__story31Layout = { samples: 0, violations: [] as string[], stop: false };
    const sample = () => {
      if (state.stop) return;
      const history = element.querySelector('[role="log"]') as HTMLElement;
      const right = history.getBoundingClientRect().right;
      state.samples++;
      if (history.scrollWidth > history.clientWidth + 1) state.violations.push('Chat history overflow');
      if (element.getBoundingClientRect().right > window.innerWidth + 1) state.violations.push('Chat pane outside window');
      for (const child of history.children) {
        if (child.getBoundingClientRect().right > right + 1) state.violations.push('Message outside history');
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await send(page);
  const reply = replies(page).first();
  for (const index of streamChunks.keys()) {
    if (index > 0) markdownFake.release(index);
    const marker = index === 0 ? 'Reading the' : index === 1 ? 'const wide =' : index === 2 ? 'stream'.repeat(140) : 'Done.';
    await expect(reply).toContainText(marker);
    if (index < streamChunks.length - 1) await expect(reply).toHaveAttribute('data-state', 'streaming');
    await contained(page);
    // Allow a paint of this gated fragment before releasing the next one.
    await reply.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (index === 1 || index === 2) {
      await expect(reply.locator('pre'), 'An unfinished fence must remain a contained code block').toHaveCount(1);
      await expect(reply.locator('pre')).toContainText('const wide =');
    }
  }
  await complete(page);
  await expect(reply.getByRole('heading', { level: 1, name: 'Stream report' })).toBeVisible();
  await expect(reply.getByRole('table')).toHaveCount(1);
  await expect(reply.locator('pre > code')).toHaveCount(1);
  await scrollsInside(reply.locator('pre'));
  await send(page, 'Show the same complete reply in one piece');
  const whole = await complete(page);
  await expect(replies(page)).toHaveCount(2);
  const render = async (message: Locator) => message.evaluate(element => {
    const visit = (node: Node): unknown => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!(node instanceof HTMLElement)) return null;
      const style = getComputedStyle(node);
      return { tag: node.tagName, color: style.color, weight: style.fontWeight, whitespace: style.whiteSpace, children: [...node.childNodes].map(visit) };
    };
    return [...element.childNodes].map(visit);
  });
  expect(await render(reply), 'Streamed and one-piece replies must finish with the same semantic tree and token colors').toEqual(await render(whole));
  const layout = await page.evaluate(() => {
    window.__story31Layout!.stop = true;
    return window.__story31Layout!;
  });
  expect(layout.samples).toBeGreaterThan(0);
  expect(layout.violations, 'No painted streaming frame may overflow the chat').toEqual([]);
  await testInfo.attach('stream-layout-samples', { body: JSON.stringify(layout), contentType: 'application/json' });
});

test('AC7: raw HTML stays visible as text and never creates elements or executes scripts', async ({ cod: { page } }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.evaluate(() => { window.__story31Executed = false; });
  await send(page);
  const reply = await complete(page);
  for (const snippet of unsafeHTML.split('\n\n')) await expect(reply).toContainText(snippet);
  await expect(reply.locator('img, script, iframe, object, embed, [onerror], [onload]')).toHaveCount(0);
  // Sample after a paint as well as at completion to catch delayed image handlers.
  await reply.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.__story31Executed), 'Raw HTML must not execute script or an image error handler').toBe(false);
  expect(dialogs).toEqual([]);
  // This positive control prevents a plain-text-only renderer from passing the safety AC.
  await expect(reply.getByRole('heading', { level: 1, name: 'Safe reply' }), 'Safe markdown must still render around escaped raw HTML').toBeVisible();
  await expect(reply.locator('strong')).toHaveText('Still safe');
});

test('AC2: headings, nested lists, bold, italic and quotes render as semantic HTML', async ({ cod: { page } }, testInfo) => {
  await send(page);
  const reply = await complete(page);
  for (const [level, name] of ['Orchard report', 'Details', 'Next steps'].entries()) {
    const heading = reply.getByRole('heading', { level: level + 1, name, exact: true });
    await expect(heading, 'Markdown headings must render instead of literal # characters').toBeVisible();
    expect(await heading.evaluate(element => element.tagName)).toBe(`H${level + 1}`);
  }
  await expect(reply.locator('ul > li > ul > li')).toHaveText('Nested bullet');
  await expect(reply.locator('ol > li > ol > li')).toHaveText('Nested step');
  await expect(reply.locator('ul > li').first()).toContainText('Parent bullet');
  await expect(reply.locator('ol > li').last()).toHaveText('Second step');
  await expect(reply.locator('strong')).toHaveText('bold phrase');
  await expect(reply.locator('em')).toHaveText('italic phrase');
  await expect(reply.locator('blockquote')).toHaveText('Quoted advice');
  await expect(reply).not.toContainText('**bold phrase**');
  await expect(reply).not.toContainText('*italic phrase*');
  await testInfo.attach('markdown-structure', { body: await page.screenshot(), contentType: 'image/png' });
});
