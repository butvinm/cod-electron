import fs from 'node:fs';
import path from 'node:path';

// Files named in a chat. Pure helpers: the caller supplies the check that a path is inside a workspace folder.

function isFile(target: string): boolean {
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

// The absolute path a mention points at, or null. A relative mention is tried against the chat's
// folder first, then each workspace folder in order. A match counts only when it is a file and
// `inside` accepts it, so a file outside the workspace is never confirmed.
export function resolveMention(mention: string, bases: string[], inside: (file: string) => boolean): string | null {
  if (typeof mention !== 'string' || mention === '' || mention.length > 1000 || mention.includes('\0')) return null;
  if (path.isAbsolute(mention)) {
    const file = path.normalize(mention);
    return isFile(file) && inside(file) ? file : null;
  }
  for (const base of bases) {
    const file = path.resolve(base, mention);
    if (isFile(file) && inside(file)) return file;
  }
  return null;
}

export interface Replacement {
  old_string: string;
  new_string: string;
}

// The 1-based line of the first change an Edit or MultiEdit made (or is about to make):
// the earliest line of any replacement. The new text is looked for first, because after the
// edit the old text is gone. Null when none of the texts is in the file.
export function firstChangedLine(text: string, edits: Replacement[]): number | null {
  let best: number | null = null;
  for (const edit of edits) {
    let at = -1;
    for (const needle of [edit.new_string, edit.old_string]) {
      if (needle !== '') at = text.indexOf(needle);
      if (at >= 0) break;
    }
    if (at < 0) continue;
    const line = text.slice(0, at).split('\n').length;
    if (best === null || line < best) best = line;
  }
  return best;
}

// Reads the replacements out of a tool input (Edit, or MultiEdit with an edits array). Anything else gives [].
export function replacementsOf(input: unknown): Replacement[] {
  if (!input || typeof input !== 'object') return [];
  const fields = input as Record<string, unknown>; // a tool input is a JSON object with any fields
  const list = Array.isArray(fields.edits) ? fields.edits : [fields];
  const found: Replacement[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { old_string: before, new_string: after } = entry as Record<string, unknown>;
    if (typeof before === 'string' || typeof after === 'string') {
      found.push({ old_string: typeof before === 'string' ? before : '', new_string: typeof after === 'string' ? after : '' });
    }
  }
  return found;
}
