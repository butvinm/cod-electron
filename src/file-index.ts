import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { EXCLUDED } from './project-fs.ts';
import { search, type FuzzyEntry } from './fuzzy.ts';
import { realOrNull, isInside } from './folders.ts';
import type { FinderResult } from './shared/ipc.ts';

interface Rule {
  base: string;
  matcher: Ignore;
}

export interface IndexEntry extends FuzzyEntry {
  root: string;
  abs: string;
}

// Rules run from the outermost .gitignore to the innermost, so a deeper explicit unignore
// beats an outer ignore, as in Git. "No match" leaves the earlier verdict alone.
function isIgnored(rules: Rule[], abs: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const { base, matcher } of rules) {
    const relative = path.relative(base, abs).split(path.sep).join('/');
    const verdict = matcher.test(isDirectory ? `${relative}/` : relative);
    if (verdict.ignored) ignored = true;
    else if (verdict.unignored) ignored = false;
  }
  return ignored;
}

// Lists every file under root that Git would not ignore, as { root, rel, abs, lower }.
// Nested .gitignore files apply to their own folder. Symlinked folders are not followed.
// A symlink whose real path leaves the root is skipped, for files and .gitignore alike.
export async function walk(root: string): Promise<IndexEntry[]> {
  const realRoot = realOrNull(root);
  if (realRoot === null) return [];
  const inside = (target: string): boolean => {
    const real = realOrNull(target);
    return real !== null && isInside(realRoot, real);
  };
  const entries: IndexEntry[] = [];
  const pending: { dir: string; rules: Rule[] }[] = [{ dir: root, rules: [] }];
  while (pending.length) {
    const { dir, rules } = pending.pop()!;
    let dirents: fs.Dirent[];
    try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    let here = rules;
    if (dirents.some(d => d.name === '.gitignore')) {
      const file = path.join(dir, '.gitignore');
      try {
        if (inside(file)) here = [...rules, { base: dir, matcher: ignore().add(await fs.promises.readFile(file, 'utf8')) }];
      } catch { /* unreadable .gitignore is treated as absent */ }
    }
    for (const dirent of dirents) {
      if (EXCLUDED.has(dirent.name)) continue;
      const abs = path.join(dir, dirent.name);
      const isDirectory = dirent.isDirectory();
      let isFile = dirent.isFile();
      if (dirent.isSymbolicLink()) {
        try { isFile = inside(abs) && (await fs.promises.stat(abs)).isFile(); } catch { isFile = false; }
      }
      if (!isDirectory && !isFile) continue;
      if (isIgnored(here, abs, isDirectory)) continue;
      if (isDirectory) { pending.push({ dir: abs, rules: here }); continue; }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      entries.push({ root, rel, abs, lower: rel.toLowerCase() });
    }
  }
  return entries;
}

interface WorkspaceIndex {
  entries: IndexEntry[] | null;
  building: Promise<void> | null;
  stale: boolean;
}

// One file list per workspace, built in the main process and searched there.
// The renderer only receives the top results.
export class FileIndex {
  rootsOf: (workspaceId: string) => string[];
  onRebuilt: (workspaceId: string) => void;
  byWorkspace = new Map<string, WorkspaceIndex>();

  // onRebuilt(workspaceId) fires when a build finishes, so the finder can re-run its query.
  constructor(rootsOf: (workspaceId: string) => string[], onRebuilt: (workspaceId: string) => void = () => {}) {
    this.rootsOf = rootsOf;
    this.onRebuilt = onRebuilt;
  }

  // Drops the list and starts again. Used when the roots change.
  reset(workspaceId: string): void {
    this.byWorkspace.delete(workspaceId);
    if (this.rootsOf(workspaceId).length) this.build(workspaceId);
  }

  // The list may be out of date (files changed on disk). Rebuilt on the next prepare().
  markAllStale(): void {
    for (const state of this.byWorkspace.values()) state.stale = true;
  }

  forget(workspaceId: string): void { this.byWorkspace.delete(workspaceId); }

  build(workspaceId: string): Promise<void> {
    const state: WorkspaceIndex = this.byWorkspace.get(workspaceId) || { entries: null, building: null, stale: false };
    this.byWorkspace.set(workspaceId, state);
    if (state.building) return state.building;
    state.stale = false;
    const roots = this.rootsOf(workspaceId);
    const building: Promise<void> = Promise.all(roots.map(walk)).then(lists => {
      if (this.byWorkspace.get(workspaceId) !== state) return;
      state.entries = lists.flat();
      this.onRebuilt(workspaceId);
    }).finally(() => { state.building = null; });
    state.building = building;
    return building;
  }

  // Called when the finder opens: build if missing, refresh if stale.
  prepare(workspaceId: string): void {
    const state = this.byWorkspace.get(workspaceId);
    if (!state || state.stale) this.build(workspaceId);
  }

  // Answers from the current list at once, so typing stays fast during a refresh.
  // Waits only when there is no list yet. onRebuilt tells the finder to ask again after a refresh.
  async query(workspaceId: string, text: string, limit = 50): Promise<FinderResult[]> {
    if (!this.byWorkspace.has(workspaceId)) this.build(workspaceId);
    let state = this.byWorkspace.get(workspaceId);
    if (state && !state.entries && state.building) await state.building;
    state = this.byWorkspace.get(workspaceId);
    if (!state || !state.entries) return [];
    return search(state.entries, text, limit).map(({ entry, positions }) => ({
      path: entry.abs,
      root: entry.root,
      rel: entry.rel,
      positions,
    }));
  }
}
