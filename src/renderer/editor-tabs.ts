// Pure editor tab list for one workspace. No DOM here, so it is easy to test.

// paths: absolute paths in tab order. active: the shown path or null. history: paths, most recent last.
export interface Tabs {
  paths: string[];
  active: string | null;
  history: string[];
}

export function createTabs(): Tabs {
  return { paths: [], active: null, history: [] };
}

const touch = (history: string[], file: string): string[] => [...history.filter(p => p !== file), file];

// Opening a file that is already open only activates it.
// A new tab goes right after the active one, as in Zed.
export function open(tabs: Tabs, file: string): Tabs {
  if (tabs.paths.includes(file)) return activate(tabs, file);
  const at = tabs.active === null ? tabs.paths.length : tabs.paths.indexOf(tabs.active) + 1;
  const paths = [...tabs.paths.slice(0, at), file, ...tabs.paths.slice(at)];
  return { paths, active: file, history: touch(tabs.history, file) };
}

export function activate(tabs: Tabs, file: string): Tabs {
  if (!tabs.paths.includes(file)) return tabs;
  return { ...tabs, active: file, history: touch(tabs.history, file) };
}

// Closing the active tab activates the tab that was active before it (Zed's activate_on_close: history).
export function close(tabs: Tabs, file: string): Tabs {
  if (!tabs.paths.includes(file)) return tabs;
  const paths = tabs.paths.filter(p => p !== file);
  const history = tabs.history.filter(p => p !== file);
  if (file !== tabs.active) return { paths, active: tabs.active, history };
  return { paths, active: history.length ? history[history.length - 1] : null, history };
}

// The path shown in the close prompt: relative to the root that holds it.
// With more than one root the root's own name leads, as in Zed.
export function displayPath(roots: string[], file: string): string {
  const sep = file.includes('\\') && !file.includes('/') ? '\\' : '/';
  const best = roots
    .filter(r => file === r || file.startsWith(r.endsWith(sep) ? r : r + sep))
    .sort((a, b) => b.length - a.length)[0];
  if (!best) return file;
  const relative = file.slice(best.length).replace(/^[\\/]+/, '');
  if (roots.length < 2) return relative || file;
  const name = best.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return `${name}${sep}${relative}`;
}

// Moves the prompt highlight by delta, wrapping around.
export function moveChoice(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

// An IPC failure arrives as "Error invoking remote method 'x': Error: reason". Keep only the reason.
export function errorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  const text = String(message || error || 'Unknown error');
  return text.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '');
}

export interface SaveAttempt {
  write: () => Promise<void>;
  report: (message: string | null) => void;
  restoreFocus: () => void;
  name: string;
}

// Runs a save. On failure it reports a message, gives focus back to the editor and resolves false,
// so the caller keeps the tab dirty. On success it clears any earlier message.
export async function attemptSave({ write, report, restoreFocus, name }: SaveAttempt): Promise<boolean> {
  try {
    await write();
    report(null);
    return true;
  } catch (error) {
    report(`Could not save ${name}: ${errorMessage(error)}`);
    restoreFocus();
    return false;
  }
}

// Runs a confirmation that guards data. Any error means "do not go on": it reports the reason and resolves false.
// Only an explicit true counts as a yes, so the confirmation may return anything.
export async function confirmOrKeep(confirm: () => unknown, report: (message: string) => void): Promise<boolean> {
  try {
    return (await confirm()) === true;
  } catch (error) {
    report(`Could not check for unsaved files: ${errorMessage(error)}`);
    return false;
  }
}

export interface Locks {
  lock(ids: string[]): void;
  unlock(ids: string[]): void;
  // Locks every workspace, now and later. Nothing unlocks it, because the app is on its way out.
  lockAll(): void;
  has(id: string): boolean;
}

// Workspaces whose editors are read-only because a close or quit is under way.
export function createLocks(): Locks {
  const locked = new Set<string>();
  let all = false;
  return {
    lock: ids => ids.forEach(id => locked.add(id)),
    unlock: ids => ids.forEach(id => locked.delete(id)),
    lockAll() { all = true; },
    has: id => all || locked.has(id),
  };
}

// A CodeMirror transaction filter: while locked, transactions that change the document are dropped.
// The filter result is either the transaction itself or an empty list of transactions.
export const editFilter = (isLocked: () => boolean) => <T extends { docChanged: boolean }>(transaction: T): T | readonly [] => (transaction.docChanged && isLocked() ? [] : transaction);
