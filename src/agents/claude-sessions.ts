// Reads the Claude CLI's own session store, read only:
// <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<folder with every character outside a-z, A-Z, 0-9 replaced by "-">/<session id>.jsonl
// Each line is one JSON record. Only records of type user and assistant are turns.
// An assistant record holds one content block (text, thinking or tool_use). A tool result is a user
// record whose content has tool_result blocks. Records of sub-agents (isSidechain) and the CLI's own
// notes (isMeta, slash command wrappers) are not part of the conversation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OpenedSession, SessionEvent, SessionSummary } from '../shared/chat.ts';

const ID = /^[A-Za-z0-9-]{8,64}$/;
// The head of a file read for a title, and the tail read for the time of the last turn.
const HEAD_BYTES = 1024 * 1024;
const TAIL_BYTES = 64 * 1024;
// Text the CLI wraps around slash commands and hook output. It is not something the person typed.
const WRAPPER = /^\s*<(?:command-|local-command-|system-|task-|bash-)/;

export function encodeFolder(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, '-');
}

export function storeRoot(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const base = env.CLAUDE_CONFIG_DIR && path.isAbsolute(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : path.join(home, '.claude');
  return path.join(base, 'projects');
}

type Json = Record<string, unknown>;

function parseLine(line: string): Json | null {
  if (!line.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' ? value as Json : null;
  } catch {
    return null;
  }
}

function blocksOf(record: Json): unknown[] | string | null {
  const message = record.message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as Json).content;
  return typeof content === 'string' || Array.isArray(content) ? content : null;
}

const isTurn = (record: Json): boolean => (record.type === 'user' || record.type === 'assistant') && record.isSidechain !== true && record.isMeta !== true;

// The text the person typed in a user record, or null for a tool result or a CLI note.
export function userText(record: Json): string | null {
  if (record.type !== 'user' || !isTurn(record)) return null;
  const content = blocksOf(record);
  let text: string;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content.map(block => (block && typeof block === 'object' && (block as Json).type === 'text' && typeof (block as Json).text === 'string' ? (block as Json).text as string : '')).filter(Boolean).join('\n');
  } else return null;
  return text.trim() && !WRAPPER.test(text) ? text : null;
}

function outputText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => (block && typeof block === 'object' && typeof (block as Json).text === 'string' ? (block as Json).text as string : '')).filter(Boolean).join('\n');
}

// The chat events a stored session replays. A turn-end closes it.
export function eventsOf(lines: string[]): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const line of lines) {
    const record = parseLine(line);
    if (!record || !isTurn(record)) continue;
    const text = userText(record);
    if (text !== null) { events.push({ type: 'user-message', text }); continue; }
    const content = blocksOf(record);
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      if (!raw || typeof raw !== 'object') continue;
      const block = raw as Json;
      if (record.type === 'assistant' && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        events.push({ type: 'text-block', text: block.text });
      } else if (record.type === 'assistant' && block.type === 'tool_use' && typeof block.id === 'string') {
        events.push({ type: 'tool-use', id: block.id, name: typeof block.name === 'string' ? block.name : 'Tool', input: block.input ?? {} });
      } else if (record.type === 'user' && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        events.push({ type: 'tool-result', id: block.tool_use_id, output: outputText(block.content), isError: block.is_error === true });
      }
    }
  }
  events.push({ type: 'turn-end' });
  return events;
}

function readRange(file: string, from: number, length: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, from);
    return buffer.toString('utf8', 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

// Title and time of last turn without reading a whole file, which may be large.
export function summarize(file: string): { title: string; updated: number } | null {
  const size = fs.statSync(file).size;
  let title: string | null = null;
  for (const line of readRange(file, 0, Math.min(size, HEAD_BYTES)).split('\n')) {
    const record = parseLine(line);
    if (!record) continue;
    const text = userText(record);
    if (text !== null) { title = text; break; }
  }
  if (title === null) return null;
  const from = Math.max(0, size - TAIL_BYTES);
  const tail = readRange(file, from, size - from).split('\n');
  if (from > 0) tail.shift(); // a partial first line
  let updated = fs.statSync(file).mtimeMs;
  for (let i = tail.length - 1; i >= 0; i--) {
    const record = parseLine(tail[i]);
    const time = record && typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (!Number.isNaN(time) && record && isTurn(record)) { updated = time; break; }
  }
  return { title: title.replace(/\s+/g, ' ').trim().slice(0, 300), updated };
}

// Folders as given and as the file system names them, since the CLI stores the real path.
function storeNames(folders: string[]): { folder: string; name: string }[] {
  const seen = new Set<string>();
  const out: { folder: string; name: string }[] = [];
  for (const folder of folders) {
    const candidates = [folder];
    try { candidates.push(fs.realpathSync(folder)); } catch { /* gone */ }
    for (const candidate of candidates) {
      const name = encodeFolder(candidate);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ folder: candidate, name });
    }
  }
  return out;
}

// The sessions of these folders, newest first.
export function listSessions(folders: string[], root: string = storeRoot()): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  for (const { folder, name } of storeNames(folders)) {
    const dir = path.join(root, name);
    let files: string[];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const id = file.slice(0, -'.jsonl'.length);
      if (!ID.test(id)) continue;
      try {
        const summary = summarize(path.join(dir, file));
        if (summary) sessions.push({ id, folder, ...summary });
      } catch { /* unreadable file: not listed */ }
    }
  }
  return sessions.sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
}

// One stored session of these folders, or null when none of them has it. The id is checked, so it cannot name another path.
export function openSession(folders: string[], id: string, root: string = storeRoot()): OpenedSession | null {
  if (!ID.test(id)) return null;
  for (const { folder, name } of storeNames(folders)) {
    const file = path.join(root, name, `${id}.jsonl`);
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    return { id, folder, events: eventsOf(text.split('\n')) };
  }
  return null;
}
