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
  // The path is checked against the roots as written before any file system call touches it,
  // so a path outside every root is never probed.
  contains(target: unknown): boolean {
    return this.realInside(target) !== null;
  }

  // The real path of target when it is inside a root, else null. The caller must use exactly this path
  // afterwards and never resolve the supplied one again, so a symlink changed in between cannot lead out.
  realInside(target: unknown): string | null {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return null;
    const lexical = path.resolve(target);
    const all = [...this.byWorkspace.values()].flat();
    if (!all.some(root => isInside(root, lexical) || isInside(realOrNull(root) ?? root, lexical))) return null;
    const real = realOrNull(lexical);
    if (real === null) return null;
    const inside = all.some(root => {
      const realRoot = realOrNull(root);
      return realRoot !== null && isInside(realRoot, real);
    });
    return inside ? real : null;
  }

  // Extra roots of a workspace besides its folders (the chat's own folder), set by the main process.
  extraRoots: (workspaceId: string) => string[] = () => [];

  // True when target is inside a root of this workspace, or inside the chat's folder.
  workspaceContains(workspaceId: string, target: unknown): boolean {
    return this.workspaceRealPath(workspaceId, target) !== null;
  }

  // The validated real path of target in this workspace (see realInside), or null.
  workspaceRealPath(workspaceId: string, target: unknown): string | null {
    const only = new Folders();
    only.byWorkspace.set(workspaceId, [...this.list(workspaceId), ...this.extraRoots(workspaceId)]);
    return only.realInside(target);
  }
}
