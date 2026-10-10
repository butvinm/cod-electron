import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const root = path.resolve(__dirname, '../../..');

type Cod = { app: ElectronApplication; page: Page; startedAt: number };

export const test = base.extend<{ cod: Cod }>({
  cod: async ({}, use, testInfo) => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const entry = path.resolve(root, manifest.main);
    expect(existsSync(entry), `Story #3 app is missing: implement package.json main (${manifest.main}) before running acceptance tests`).toBe(true);

    const profile = mkdtempSync(path.join(tmpdir(), 'cod-story-3-'));
    let app: ElectronApplication | undefined;
    try {
      const startedAt = performance.now();
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({
        args: [root, `--user-data-dir=${profile}`],
        cwd: root,
        env: { ...env, COD_USER_DATA_DIR: profile },
        timeout: 15_000,
        recordVideo: { dir: testInfo.outputPath('video') },
      });
      const page = await app.firstWindow({ timeout: 15_000 });
      try {
        await page.waitForLoadState('load');
        await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
        await expect(page.getByTestId('workspace-tab')).toBeVisible();
        await use({ app, page, startedAt });
      } finally {
        if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
          await testInfo.attach('window', { body: await page.screenshot(), contentType: 'image/png' });
        }
      }
    } finally {
      try {
        if (app) {
          const process = app.process();
          if (process.exitCode === null && process.signalCode === null) {
            const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
            const killTimeout = setTimeout(() => process.kill('SIGKILL'), 2_000);
            try {
              // Teardown bypasses quit prompts. Exiting can disconnect evaluate before it returns.
              void app.evaluate(({ app }) => app.exit(0)).catch(() => {});
              await exited;
            } finally {
              clearTimeout(killTimeout);
            }
          }
        }
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    }
  },
});

export { expect };
