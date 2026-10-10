import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { root } from './electron';

export const shortcuts = {
  macos: { next: 'cmd-alt-shift-j', previous: 'cmd-alt-shift-k', close: 'cmd-alt-shift-q' },
  linux: { next: 'ctrl-alt-shift-j', previous: 'ctrl-alt-shift-k', close: 'ctrl-alt-shift-q' },
};

// Compare modifier sets, not their spelling order. Also reject a chord's first stroke.
export function normalizeStroke(stroke: string): string {
  const parts = stroke.toLowerCase().split('-');
  const key = parts.pop();
  return [...parts.sort(), key].join('-');
}

export function zedBindings(platform: 'macos' | 'linux'): string[] {
  const file = path.join(root, 'tests/fixtures/zed-keymaps', `default-${platform}.json`);
  // The config parser supports JSONC but requires an object root. Preserve the
  // complete keymap array inside an object so every context is still checked.
  const parsed = ts.parseConfigFileTextToJson(file, `{"contexts": ${readFileSync(file, 'utf8')}\n}`);
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  return parsed.config.contexts.flatMap((context: { bindings?: Record<string, unknown> }) => Object.keys(context.bindings ?? {}));
}

export function toPlaywright(stroke: string): string {
  const names: Record<string, string> = { cmd: 'Meta', ctrl: 'Control', alt: 'Alt', shift: 'Shift' };
  return stroke.split('-').map(key => names[key] ?? key).join('+');
}

export const platform = process.platform === 'darwin' ? 'macos' : 'linux';
export const keys = shortcuts[platform];
export const newWorkspaceKey = process.platform === 'darwin' ? 'Meta+Shift+n' : 'Control+Shift+n';
