// Bundles the CodeMirror editor module for the renderer. Everything else in the renderer is plain JS.
// Output goes to src/renderer/dist/ (git-ignored): it is generated, and `npm install`, `npm start` and `npm run test:e2e` all rebuild it.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'src/renderer/editor-cm.js')],
  outfile: path.join(root, 'src/renderer/dist/editor-cm.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome140',
  legalComments: 'none',
  logLevel: 'warning',
});
