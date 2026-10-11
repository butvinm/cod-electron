import fs from 'node:fs';
import path from 'node:path';

// How many recent folders are remembered. The start screen shows the first five.
export const MAX_RECENT = 30;

// Puts a folder first, drops an earlier copy, and keeps at most `max` entries.
export function pushRecent(list: string[], folder: string, max: number = MAX_RECENT): string[] {
  return [folder, ...list.filter(item => item !== folder)].slice(0, max);
}

// Keeps only absolute string paths, once each. Anything else in a damaged file is dropped.
export function cleanRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) if (typeof item === 'string' && path.isAbsolute(item)) seen.add(item);
  return [...seen].slice(0, MAX_RECENT);
}

// The recently opened folders, most recent first, kept in one JSON file in the user data directory.
export class RecentFolders {
  file: string;
  list: string[];

  constructor(file: string) {
    this.file = file;
    this.list = [];
    try { this.list = cleanRecent(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* no file yet, or damaged: start empty */ }
  }

  // Folders that were deleted since are left out of what is shown, but stay on disk until pushed out.
  get(): string[] {
    return this.list.filter(folder => fs.existsSync(folder));
  }

  has(folder: string): boolean {
    return this.list.includes(folder);
  }

  add(folders: string[]): void {
    // The first folder picked ends up first, so it is added last.
    for (const folder of [...folders].reverse()) this.list = pushRecent(this.list, folder);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.list));
    } catch (error) {
      console.error(error);
    }
  }
}
