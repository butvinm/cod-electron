import { expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { root } from './helpers/electron';
import path from 'node:path';

export default async function globalSetup() {
  if (!process.env.CI) return;

  // Prime Electron's CI startup caches once. Measured tests still get a fresh
  // profile, and local runs retain the stakeholder's cold-start measurement.
  const profile = mkdtempSync(path.join(tmpdir(), 'cod-story-3-warmup-'));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      args: [root, `--user-data-dir=${profile}`],
      cwd: root,
      env: { ...env, COD_USER_DATA_DIR: profile },
      timeout: 15_000,
    });
    const page = await app.firstWindow({ timeout: 15_000 });
    await page.waitForLoadState('load');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
    await expect(page.getByTestId('workspace-tab')).toBeVisible();
  } finally {
    try { await app?.close(); } finally { rmSync(profile, { recursive: true, force: true }); }
  }
}
