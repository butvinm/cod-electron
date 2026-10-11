// Builds the app into dist/ (git-ignored): `npm install`, `npm start`, `npm test` and `npm run test:e2e` all run it.
//   dist/main.js           main process (CommonJS, Electron stays external)
//   dist/preload.js        preload script (CommonJS, one file because the sandboxed preload cannot require local files)
//   dist/renderer/app.js   the page: app code and CodeMirror in one script, so the CSP needs no inline script
//   dist/renderer/*        index.html, CSS and fonts, copied as they are
// Run with: node --experimental-strip-types scripts/build.ts
import { build, type BuildOptions } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');

const common: BuildOptions = {
  bundle: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
};

rmSync(out, { recursive: true, force: true });

await Promise.all([
  build({
    ...common,
    entryPoints: { main: path.join(root, 'src/main.ts'), preload: path.join(root, 'src/preload.ts') },
    outdir: out,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: { app: path.join(root, 'src/renderer/app.ts') },
    outdir: path.join(out, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
  }),
]);

// Assets stay as they are in the source tree.
const assets = path.join(root, 'src/renderer');
mkdirSync(path.join(out, 'renderer'), { recursive: true });
for (const name of readdirSync(assets)) {
  if (/\.(html|css)$/.test(name)) cpSync(path.join(assets, name), path.join(out, 'renderer', name));
}
cpSync(path.join(assets, 'fonts'), path.join(out, 'renderer', 'fonts'), { recursive: true });
