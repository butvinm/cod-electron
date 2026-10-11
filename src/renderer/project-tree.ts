// Pure project tree logic. No DOM and no file system here, so it is easy to test.
import type { DirEntry } from '../shared/ipc.ts';

export interface Row {
  path: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  parent: string | null;
  rootPath: string;
  expanded: boolean;
}

// What the panel should do for a key: exactly one of the fields is set.
export interface Navigation {
  select?: string;
  expand?: string;
  collapse?: string;
  open?: string;
}

// Flattens roots into the visible rows.
// roots: absolute paths. expanded: Set of paths. children: path -> entries of that folder.
export function visibleRows(roots: string[], expanded: Set<string>, children: Record<string, DirEntry[] | undefined>): Row[] {
  const rows: Row[] = [];
  function walk(entry: { name: string; path: string; isDirectory: boolean }, depth: number, parent: string | null, rootPath: string): void {
    const open = entry.isDirectory && expanded.has(entry.path);
    rows.push({ path: entry.path, name: entry.name, isDirectory: entry.isDirectory, depth, parent, rootPath, expanded: open });
    if (open) for (const child of children[entry.path] || []) walk(child, depth + 1, entry.path, rootPath);
  }
  for (const rootPath of roots) {
    const name = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
    walk({ name, path: rootPath, isDirectory: true }, 0, null, rootPath);
  }
  return rows;
}

// The folders between a root and a file, outermost first, root included. Empty when the file is in no root.
export function ancestorsOf(roots: string[], file: string): string[] {
  for (const rootPath of roots) {
    const sep = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/';
    const base = rootPath.endsWith(sep) ? rootPath.slice(0, -1) : rootPath;
    if (!file.startsWith(base + sep)) continue;
    const dirs = [rootPath];
    const parts = file.slice(base.length + 1).split(sep).slice(0, -1);
    let current = base;
    for (const part of parts) {
      current += sep + part;
      dirs.push(current);
    }
    return dirs;
  }
  return [];
}

// Maps a key to what the panel should do. Returns null when the key means nothing here.
export function navigate(rows: Row[], selected: string | null, key: string): Navigation | null {
  if (rows.length === 0) return null;
  const index = rows.findIndex(r => r.path === selected);
  const row: Row | undefined = rows[index];
  switch (key) {
    case 'ArrowDown':
      return { select: rows[index < 0 ? 0 : Math.min(index + 1, rows.length - 1)].path };
    case 'ArrowUp':
      return { select: rows[index < 0 ? rows.length - 1 : Math.max(index - 1, 0)].path };
    case 'Home':
      return { select: rows[0].path };
    case 'End':
      return { select: rows[rows.length - 1].path };
    case 'ArrowRight':
      if (!row || !row.isDirectory) return null;
      if (!row.expanded) return { expand: row.path };
      return rows[index + 1] && rows[index + 1].parent === row.path ? { select: rows[index + 1].path } : null;
    case 'ArrowLeft':
      if (!row) return null;
      if (row.isDirectory && row.expanded) return { collapse: row.path };
      return row.parent ? { select: row.parent } : null;
    case 'Enter':
    case ' ':
      return row && !row.isDirectory ? { open: row.path } : null;
    default:
      return null;
  }
}

// Panel state of one workspace: whether it is open, which folders are expanded, what is selected.
export interface PanelState {
  open: boolean;
  expanded: Set<string>;
  selected: string | null;
}

export function createPanelState(): PanelState {
  return { open: false, expanded: new Set(), selected: null };
}
