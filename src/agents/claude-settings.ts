import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode } from '../shared/chat.ts';

// Maps a mode name from Claude's settings or from the CLI to one of the modes Cod offers.
// Names Cod does not offer (bypassPermissions, dontAsk) and unknown names give null.
export function modeFromName(name: unknown): PermissionMode | null {
  switch (name) {
    case 'default': case 'manual': return 'manual';
    case 'acceptEdits': return 'acceptEdits';
    case 'plan': return 'plan';
    case 'auto': return 'auto';
    default: return null;
  }
}

// The mode a new chat starts in: permissions.defaultMode of the user's Claude settings
// (CLAUDE_CONFIG_DIR, else ~/.claude), or Manual when the file or the setting is missing or unusable.
export function readDefaultMode(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): PermissionMode {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as { permissions?: { defaultMode?: unknown } } | null;
    return modeFromName(settings?.permissions?.defaultMode) ?? 'manual';
  } catch {
    return 'manual';
  }
}
