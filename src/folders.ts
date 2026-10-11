import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { RootsChanged } from './shared/ipc.ts';

export function realOrNull(target: unknown): string | null {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return null;
  try { return fs.realpathSync(target); } catch { return null; }
}

// Exactly ".." or ".." plus a separator escapes; a name like "..cache" does not.
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

// The one place that knows which folders each workspace holds.
// Anything that changes a workspace's folders (the panel today, codctl later) goes through add().
// Listeners on 'change' get { workspaceId, roots }.
export class Folders extends EventEmitter<{ change: [RootsChanged] }> {
  byWorkspace = new Map<string, string[]>();

  list(workspaceId: string): string[] {
    return [...(this.byWorkspace.get(workspaceId) || [])];
  }

  // Adds absolute folder paths, skipping duplicates. Returns the paths that were new.
  add(workspaceId: string, folders: string[]): string[] {
    const roots = this.byWorkspace.get(workspaceId) || [];
    const added: string[] = [];
    for (const folder of folders) {
      if (!path.isAbsolute(folder)) throw new Error(`Folder path must be absolute: ${folder}`);
      const clean = path.resolve(folder);
      if (roots.includes(clean) || added.includes(clean)) continue;
      added.push(clean);
    }
    if (added.length === 0) return added;
    this.byWorkspace.set(workspaceId, [...roots, ...added]);
    this.emit('change', { workspaceId, roots: this.list(workspaceId) });
    return added;
  }

  forget(workspaceId: string): void {
    if (this.byWorkspace.delete(workspaceId)) this.emit('change', { workspaceId, roots: [] });
  }

  // True when target is a root of any workspace, or inside one.
  // Both sides go through realpath, so a symlink that leads out of a root does not count.
  // A path that does not exist is not contained.
  contains(target: unknown): boolean {
    const real = realOrNull(target);
    if (real === null) return false;
    for (const roots of this.byWorkspace.values()) {
      for (const root of roots) {
        const realRoot = realOrNull(root);
        if (realRoot !== null && isInside(realRoot, real)) return true;
      }
    }
    return false;
  }

  // True when target is inside a root of this workspace.
  workspaceContains(workspaceId: string, target: unknown): boolean {
    const only = new Folders();
    only.byWorkspace.set(workspaceId, this.list(workspaceId));
    return only.contains(target);
  }
}
