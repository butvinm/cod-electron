import fs from 'node:fs';
import path from 'node:path';
import { realOrNull, type Folders } from './folders.ts';
import type { Eol, FileContents } from './shared/ipc.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const EOLS: Record<Eol, string> = { lf: '\n', crlf: '\r\n', cr: '\r' };
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Splits file bytes into editor text plus what is needed to write the same bytes back.
// Only valid UTF-8 opens, with or without a BOM. Line endings must be all LF, all CRLF or all CR.
// The text uses "\n" for every line break, whatever the file had; `eol` and `bom` restore the original on save.
export function decode(buffer: Buffer): FileContents {
  if (buffer.includes(0)) throw new Error('Binary files cannot be opened');
  const bom = buffer.length >= 3 && buffer.subarray(0, 3).equals(BOM);
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? buffer.subarray(3) : buffer);
  } catch {
    throw new Error('The file is not valid UTF-8 and cannot be opened without changing it');
  }
  const crlf = (raw.match(/\r\n/g) || []).length;
  const cr = (raw.match(/\r(?!\n)/g) || []).length;
  const lf = (raw.match(/(?<!\r)\n/g) || []).length;
  if ([crlf, cr, lf].filter(n => n > 0).length > 1) throw new Error('The file mixes line endings and cannot be opened without changing it');
  const eol: Eol = crlf > 0 ? 'crlf' : cr > 0 ? 'cr' : 'lf';
  return { text: raw.replace(/\r\n|\r/g, '\n'), eol, bom };
}

// The contents come from the page, so every field is checked.
export function encode({ text, eol, bom }: Partial<FileContents>): Buffer {
  if (typeof text !== 'string' || typeof eol !== 'string' || !Object.hasOwn(EOLS, eol) || typeof bom !== 'boolean') throw new Error('Invalid file contents');
  const body = Buffer.from(text.replace(/\n/g, EOLS[eol]), 'utf8');
  return bom ? Buffer.concat([BOM, body]) : body;
}

export interface EditorFilesOptions {
  fsImpl?: typeof fs;
  hooks?: { beforeCommit?: (temp: string, real: string) => void };
}

// Reads and writes the text of files for the editor.
// `folders` is the Folders model. The path is resolved to its real path once, containment is checked on that,
// and only that real path is used afterwards, so a symlink swapped in later cannot move the access outside the workspace.
// `hooks.beforeCommit` runs after the temp file is written and before it replaces the target (for tests).
export class EditorFiles {
  folders: Folders;
  fs: typeof fs;
  hooks: NonNullable<EditorFilesOptions['hooks']>;

  constructor(folders: Folders, { fsImpl = fs, hooks = {} }: EditorFilesOptions = {}) {
    this.folders = folders;
    this.fs = fsImpl;
    this.hooks = hooks;
  }

  resolve(workspaceId: string, file: string): string {
    // workspaceRealPath checks the roots against the path as written before any file system call, then
    // against its real path. Only that real path is used afterwards, never the supplied one again.
    const real = this.folders.workspaceRealPath(workspaceId, file);
    if (real === null) throw new Error('Not inside a workspace folder');
    if (!this.fs.statSync(real).isFile()) throw new Error('Not a file');
    return real;
  }

  read(workspaceId: string, file: string): FileContents {
    const real = this.resolve(workspaceId, file);
    const fd = this.fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      if (this.fs.fstatSync(fd).size > MAX_BYTES) throw new Error('File is too large to open');
      return decode(this.fs.readFileSync(fd));
    } finally {
      this.fs.closeSync(fd);
    }
  }

  // Only existing files are written, atomically: a temp file in the same directory is written and synced,
  // then renamed over the target. A failure leaves the original bytes alone and removes the temp file.
  write(workspaceId: string, file: string, contents: Partial<FileContents> | undefined): void {
    const bytes = encode(contents || {});
    const real = this.resolve(workspaceId, file);
    const dir = path.dirname(real);
    const mode = this.fs.statSync(real).mode & 0o7777;
    const temp = path.join(dir, `.${path.basename(real)}.cod-${process.pid}-${Date.now()}.tmp`);
    let fd: number | null = null;
    try {
      fd = this.fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      // writeSync may write fewer bytes than asked, so loop until all are out. No progress is an error.
      for (let done = 0; done < bytes.length;) {
        const n = this.fs.writeSync(fd, bytes, done, bytes.length - done);
        if (!(n > 0)) throw new Error('Could not write the whole file');
        done += n;
      }
      this.fs.fchmodSync(fd, mode);
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = null;
      if (this.hooks.beforeCommit) this.hooks.beforeCommit(temp, real);
      // The directory and the target must still be what was checked.
      if (realOrNull(dir) !== dir || realOrNull(real) !== real || this.fs.lstatSync(real).isSymbolicLink()) throw new Error('The file changed while saving');
      this.fs.renameSync(temp, real);
    } catch (error) {
      if (fd !== null) { try { this.fs.closeSync(fd); } catch { /* already failing */ } }
      try { this.fs.unlinkSync(temp); } catch { /* the temp file may not exist */ }
      throw error;
    }
  }
}
