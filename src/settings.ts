// The settings file: $XDG_CONFIG_HOME/cod/settings.json, else ~/.config/cod/settings.json.
// JSON with comments and trailing commas, like Zed's. Only default_chat_folder is read for now.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Removes // and /* */ comments and trailing commas in one scan that knows where strings are.
// Text inside strings stays as it is. An unterminated block comment throws.
export function stripJsonComments(text: string): string {
  const out: string[] = [];
  let comma = -1; // index in out of a comma that only whitespace or comments follow
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i, j + 1));
      i = j + 1;
      comma = -1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new SyntaxError('Unterminated comment');
      i = end + 2;
      out.push(' ');
    } else {
      if (ch === ',') comma = out.length;
      else if ((ch === '}' || ch === ']') && comma >= 0) out[comma] = '';
      if (!/\s/.test(ch) && ch !== ',') comma = -1;
      out.push(ch);
      i++;
    }
  }
  return out.join('');
}

export function settingsPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  return path.join(base, 'cod', 'settings.json');
}

export interface DefaultChatFolder {
  // The folder to use, or null when the home folder applies.
  folder: string | null;
  // One line naming the problem, when there is one.
  notice: string | null;
}

export function readDefaultChatFolder(file: string = settingsPath()): DefaultChatFolder {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { folder: null, notice: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch {
    return { folder: null, notice: `Invalid JSON in settings.json (${file}), so the chat runs in your home folder.` };
  }
  const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).default_chat_folder : undefined;
  if (value === undefined || value === null) return { folder: null, notice: null };
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    return { folder: null, notice: `default_chat_folder in settings.json must be an absolute path, so the chat runs in your home folder.` };
  }
  let isDirectory = false;
  try { isDirectory = fs.statSync(value).isDirectory(); } catch { /* missing */ }
  if (!isDirectory) return { folder: null, notice: `default_chat_folder ${value} does not exist, so the chat runs in your home folder.` };
  return { folder: value, notice: null };
}
