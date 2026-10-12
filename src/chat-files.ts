import fs from 'node:fs';
import path from 'node:path';
import { isInside } from './folders.ts';

// Files named in a chat. The allowed roots are the chat's folder and the workspace folders.

export interface FsProbe {
  realpathSync(target: string): string;
  statSync(target: string): { isFile(): boolean };
}

// The file a path means when it is a file inside one of the roots, else null.
// The path is checked against the roots as written first, so a path outside them never reaches the
// file system. Then the real path must stay inside the real root, so a symlink cannot lead out.
export function confineFile(file: string, roots: string[], probe: FsProbe = fs): string | null {
  const lexical = path.resolve(file);
  const root = roots.find(candidate => isInside(candidate, lexical));
  if (root === undefined) return null;
  try {
    const real = probe.realpathSync(lexical);
    if (!isInside(probe.realpathSync(root), real) || !probe.statSync(real).isFile()) return null;
  } catch { return null; }
  return lexical;
}

// The absolute path a mention points at, or null. A relative mention is tried against each root in
// order (the chat's folder first). An absolute one must lie inside a root.
export function resolveMention(mention: unknown, roots: string[], probe: FsProbe = fs): string | null {
  if (typeof mention !== 'string' || mention === '' || mention.length > 1000 || mention.includes('\0')) return null;
  if (path.isAbsolute(mention)) return confineFile(mention, roots, probe);
  for (const base of roots) {
    const file = confineFile(path.resolve(base, mention), roots, probe);
    if (file !== null) return file;
  }
  return null;
}

export interface Replacement {
  old_string: string;
  new_string: string;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// The 1-based line where one replacement starts to differ. Before the edit the old text is in the file:
// its position is exact, and a deletion points at the line where the text was. After the edit the new text
// is looked for, and the part it shares with the old text is skipped. A deletion that is already done
// cannot be located and gives null.
export function changedLine(text: string, edit: Replacement): number | null {
  const skip = commonPrefix(edit.old_string, edit.new_string);
  let at = edit.old_string === '' ? -1 : text.indexOf(edit.old_string);
  if (at < 0 && edit.new_string !== '') at = text.indexOf(edit.new_string);
  if (at < 0) return null;
  return text.slice(0, at + skip).split('\n').length;
}

// The earliest line of any replacement of an Edit or MultiEdit.
export function firstChangedLine(text: string, edits: Replacement[]): number | null {
  let best: number | null = null;
  for (const edit of edits) {
    const line = changedLine(text, edit);
    if (line !== null && (best === null || line < best)) best = line;
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
