import fs from 'node:fs';
import path from 'node:path';
import type { DirEntry } from './shared/ipc.ts';

// Zed 1.23.2 default file_scan_exclusions, matched on the file name.
export const EXCLUDED = new Set(['.git', '.svn', '.hg', '.jj', '.sl', '.repo', 'CVS', '.DS_Store', 'Thumbs.db', '.classpath', '.settings']);

// Case-insensitive natural order, so file2 comes before file10.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function compare(a: Pick<DirEntry, 'name' | 'isDirectory'>, b: Pick<DirEntry, 'name' | 'isDirectory'>): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  // Names equal ignoring case: lowercase first, as Zed does.
  return collator.compare(a.name, b.name) || (a.name > b.name ? -1 : a.name < b.name ? 1 : 0);
}

// Lists one directory: folders first, then files, hidden scan exclusions left out.
export function readDir(dir: string): DirEntry[] {
  const entries: DirEntry[] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(dirent.name)) continue;
    let isDirectory = dirent.isDirectory();
    if (dirent.isSymbolicLink()) {
      try { isDirectory = fs.statSync(path.join(dir, dirent.name)).isDirectory(); } catch { /* broken link stays a file */ }
    }
    entries.push({ name: dirent.name, path: path.join(dir, dirent.name), isDirectory });
  }
  return entries.sort(compare);
}
