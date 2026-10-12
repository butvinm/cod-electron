import os from 'node:os';
import type { ChatEvent, ChatInfo, PermissionAnswer, PermissionMode } from '../shared/chat.ts';
import type { AgentProvider, AgentSession } from './provider.ts';
import { resumeCommand } from './handoff.ts';

function permissionKey(event: { tool: string; input: unknown }): string {
  return JSON.stringify([event.tool, event.input]);
}

// A process not yet gone (idle, busy, ending or interrupted), with the chat that owns it.
// Known by its Claude session id once that is known. At most one process per session id may be live.
// Chats are replaced (New Claude Chat, opening a session) but this record lives until the process exits.
interface Live {
  id: string | null;
  session: AgentSession;
  owner: Chat;
  // Set when Cod ends the process on purpose. Resolves when it is gone.
  ending: Promise<void> | null;
  exited: Promise<void>;
  exit: () => void;
}

// What handoff and send get back when another chat is in a turn on the same session.
export const BUSY_ELSEWHERE = 'busy-elsewhere';
export const BUSY_ELSEWHERE_TEXT = 'This session is busy in another chat';

interface Chat {
  session: AgentSession | null;
  sessionId: string | null;
  cwd: string | null;
  busy: boolean;
  mode: PermissionMode;
  // Set when New Claude Chat replaced this chat: no event of it is forwarded any more.
  discarded: boolean;
  // Requests approved for this session.
  allowed: Set<string>;
  // Request id -> key of a request on screen.
  asked: Map<string, string>;
  // The folder of an opened CLI session. It stays the working folder of this chat.
  fixedCwd: string | null;
}

export interface ChatsOptions {
  provider: AgentProvider;
  folders: { list: (workspaceId: string) => string[] };
  emit: (workspaceId: string, event: ChatEvent) => void;
  home?: string;
  // The mode a new chat starts in (the user's Claude settings). Manual when not given.
  defaultMode?: () => PermissionMode;
  // The settings' default folder for a workspace without folders.
  defaultFolder?: () => { folder: string | null; notice: string | null };
}

// One chat per workspace. Owns the agent session of each workspace and the choice of
// working directory. It talks to a provider (see claude.ts) and reports plain events.
//
// A process keeps the directory it started in. When the workspace's first folder changes,
// the process is ended at a safe point (never in the middle of a turn) and the next message
// starts a new process that resumes the same session in the new directory.
//
// Permission requests ({ type: 'permission-request', id, tool, input }) are shown to the person
// and answered with answerPermission. "Allow for this session" is remembered here, per chat,
// for the same tool and the same input, so it works the same for any provider.
//
// emit(workspaceId, event) receives every event of every chat.
export class Chats {
  provider: AgentProvider;
  folders: ChatsOptions['folders'];
  emit: ChatsOptions['emit'];
  home: string;
  defaultMode: () => PermissionMode;
  defaultFolder: NonNullable<ChatsOptions['defaultFolder']>;
  chats = new Map<string, Chat>();
  // Every session not yet gone, including interrupted ones.
  // The registry of every process not yet gone. A process Cod is ending is waited for by anything
  // that would start or hand off the same Claude session id, so one process writes to a session at a time.
  live = new Map<AgentSession, Live>();

  constructor({ provider, folders, emit, home = os.homedir(), defaultMode = () => 'manual', defaultFolder = () => ({ folder: null, notice: null }) }: ChatsOptions) {
    this.defaultMode = defaultMode;
    this.defaultFolder = defaultFolder;
    this.provider = provider;
    this.folders = folders;
    this.emit = emit;
    this.home = home;
  }

  // First folder of the workspace, else the settings' default folder, else home.
  _choice(workspaceId: string): { cwd: string; notice: string | null } {
    const fixed = this.chats.get(workspaceId)?.fixedCwd;
    if (fixed) return { cwd: fixed, notice: null };
    const first = this.folders.list(workspaceId)[0];
    if (first) return { cwd: first, notice: null };
    const { folder, notice } = this.defaultFolder();
    return { cwd: folder || this.home, notice };
  }

  _wanted(workspaceId: string): string {
    return this._choice(workspaceId).cwd;
  }

  // The directory Claude really runs in: the running process's, else the one the next message will use.
  info(workspaceId: string): ChatInfo {
    const chat = this.chats.get(workspaceId);
    const running = chat && chat.session && chat.session.alive && !chat.session.interrupting;
    const { cwd: wanted, notice } = this._choice(workspaceId);
    const cwd = running && chat.cwd !== null ? chat.cwd : wanted;
    return notice ? { cwd, home: cwd === this.home, notice } : { cwd, home: cwd === this.home };
  }

  _chat(workspaceId: string): Chat {
    let chat = this.chats.get(workspaceId);
    if (!chat) {
      chat = { session: null, sessionId: null, cwd: null, busy: false, mode: this.defaultMode(), discarded: false, allowed: new Set(), asked: new Map(), fixedCwd: null };
      this.chats.set(workspaceId, chat);
    }
    return chat;
  }

  // Ends an idle process whose directory is no longer the wanted one.
  _settle(workspaceId: string): void {
    const chat = this.chats.get(workspaceId);
    if (!chat || !chat.session || chat.busy) return;
    if (chat.cwd !== this._wanted(workspaceId)) {
      const session = chat.session;
      chat.session = null;
      this._end(session);
    }
  }

  // Ends a process on purpose. Resolves when it is gone.
  _end(session: AgentSession): Promise<void> {
    const live = this.live.get(session);
    const done = Promise.resolve(session.close()).then(() => this._gone(session));
    if (live) live.ending = done;
    if (!session.alive) this._gone(session);
    return done;
  }

  _gone(session: AgentSession): void {
    this.live.get(session)?.exit();
    this.live.delete(session);
  }

  // One rule for the whole app: at most one live process per session id. Before chat C starts or
  // hands off session X, every other process of X must be gone: an idle one of another chat is ended
  // (that chat resumes later), an ending or interrupted one is waited for, and a busy one of another
  // chat blocks C. Returns { busy } or { wait } (null when nothing is in the way).
  _clear(sessionId: string | null, chat: Chat): { busy: boolean; wait: Promise<void> | null } {
    const waits: Promise<void>[] = [];
    if (sessionId) {
      for (const live of [...this.live.values()]) {
        if (live.id !== sessionId) continue;
        if (live.ending) waits.push(live.ending);
        else if (live.session.interrupting) waits.push(live.exited);
        else if (live.owner !== chat) {
          if (live.owner.busy) return { busy: true, wait: null };
          live.owner.session = null;
          waits.push(this._end(live.session));
        }
      }
    }
    return { busy: false, wait: waits.length ? Promise.all(waits).then(() => {}) : null };
  }

  // The first folder of a workspace may have changed.
  foldersChanged(workspaceId: string): void {
    this._settle(workspaceId);
  }

  send(workspaceId: string, text: string): void {
    const chat = this._chat(workspaceId);
    this._settle(workspaceId);
    // Another process of this session must be gone before this chat writes to it.
    const clear = this._clear(chat.sessionId, chat);
    if (clear.busy) {
      this.emit(workspaceId, { type: 'error', kind: 'failed', message: BUSY_ELSEWHERE_TEXT });
      return;
    }
    if (clear.wait) {
      clear.wait.then(() => { if (this.chats.get(workspaceId) === chat) this.send(workspaceId, text); });
      return;
    }
    chat.busy = true;
    if (!chat.session || !chat.session.alive || chat.session.interrupting) {
      const cwd = this._wanted(workspaceId);
      let live: Live | undefined;
      const session: AgentSession = this.provider.start({
        cwd,
        // A process that ended (after an interrupt, say) is replaced by one that resumes the same session.
        resume: chat.sessionId || undefined,
        permissionMode: chat.mode,
        onEvent: event => {
          // A chat replaced by New Claude Chat is silent.
          if (chat.discarded) return;
          // The interrupted marker of an older process still counts.
          if (chat.session !== session && event.type !== 'interrupted') return;
          if (event.type === 'session') chat.sessionId = event.id;
          if (event.type === 'session' && live) live.id = event.id;
          // A mode the process reports itself. The label follows; nothing is sent back.
          if (event.type === 'mode') chat.mode = event.mode;
          const current = chat.session === session;
          if (event.type === 'permission-request') {
            // A request approved for this session is answered without asking again.
            const key = permissionKey(event);
            if (chat.allowed.has(key)) { session.answerPermission(event.id, { allow: true }); return; }
            chat.asked.set(event.id, key);
          } else if (event.type === 'permission-clear') chat.asked.delete(event.id);
          else if (['turn-end', 'error', 'interrupted'].includes(event.type)) chat.asked.clear();
          if (current && (event.type === 'turn-end' || event.type === 'error' || event.type === 'interrupted')) chat.busy = false;
          this.emit(workspaceId, event);
          if (current) this._settle(workspaceId);
        },
        onExit: () => {
          this._gone(session);
          if (chat.session === session) { chat.session = null; chat.busy = false; }
        },
      });
      chat.session = session;
      chat.cwd = cwd;
      let exit = () => {};
      const exited = new Promise<void>(resolve => { exit = resolve; });
      live = { id: chat.sessionId, session, owner: chat, ending: null, exited, exit };
      this.live.set(session, live);
    }
    chat.session.send(text);
  }

  // The answer to a permission request. Scope 'session' remembers an allow for the same tool
  // and input until the chat is forgotten.
  answerPermission(workspaceId: string, id: string, answer: PermissionAnswer): void {
    const chat = this.chats.get(workspaceId);
    if (!chat || !chat.session) return;
    const key = chat.asked.get(id);
    if (key === undefined) return;
    chat.asked.delete(id);
    if (answer.allow && answer.scope === 'session') chat.allowed.add(key);
    chat.session.answerPermission(id, { allow: answer.allow, message: answer.message, ...(answer.answers ? { answers: answer.answers } : {}) });
  }

  // The permission mode of the chat, for the composer label.
  mode(workspaceId: string): PermissionMode {
    return this._chat(workspaceId).mode;
  }

  // The person chose a mode. A running process is told; otherwise the next process starts with it.
  setMode(workspaceId: string, mode: PermissionMode): void {
    const chat = this._chat(workspaceId);
    if (chat.mode === mode) return;
    chat.mode = mode;
    const session = chat.session;
    if (session && session.alive && !session.interrupting) session.setPermissionMode?.(mode);
  }

  // Continue in Terminal: returns the command and ends the idle process, so the terminal is
  // the only writer. The next message starts a process that resumes the same session.
  // Returns null while a turn runs or before the session has an id.
  // Returns BUSY_ELSEWHERE when another chat is in a turn on the same session.
  handoff(workspaceId: string): Promise<string | null> {
    const chat = this.chats.get(workspaceId);
    if (!chat || chat.busy || !chat.sessionId) return Promise.resolve(null);
    const id = chat.sessionId;
    const command = resumeCommand(chat.cwd ?? this._wanted(workspaceId), id);
    if (this._clear(id, chat).busy) return Promise.resolve(BUSY_ELSEWHERE);
    const session = chat.session;
    chat.session = null;
    if (session) this._end(session);
    // Every other process of this session, ended by this call or an earlier one, must be gone first.
    return Promise.resolve(this._clear(id, chat).wait).then(() => command);
  }

  interrupt(workspaceId: string): void {
    this.chats.get(workspaceId)?.session?.interrupt();
  }

  // New Claude Chat: the old process ends and the next message starts a new session (no resume).
  // The old session stays on disk for the CLI.
  reset(workspaceId: string): Promise<void> {
    const chat = this.chats.get(workspaceId);
    this.chats.delete(workspaceId);
    if (!chat) return Promise.resolve();
    chat.discarded = true;
    if (!chat.session) return Promise.resolve();
    // Detach first, so late events of the old process never reach the new chat.
    const session = chat.session;
    chat.session = null;
    chat.busy = false;
    chat.asked.clear();
    return this._end(session);
  }

  // The folders whose stored Claude sessions the workspace lists: its own, else the one the chat would run in.
  sessionFolders(workspaceId: string): string[] {
    const own = this.folders.list(workspaceId);
    if (own.length > 0) return own;
    const { folder } = this.defaultFolder();
    return [folder || this.home];
  }

  // Opening a CLI session: the chat is replaced, as New Claude Chat does, and the next message
  // resumes that session in the folder it was made in. Nothing is started here.
  async open(workspaceId: string, sessionId: string, folder: string): Promise<void> {
    await this.reset(workspaceId);
    const chat = this._chat(workspaceId);
    chat.sessionId = sessionId;
    chat.fixedCwd = folder;
  }

  forget(workspaceId: string): Promise<void> {
    const chat = this.chats.get(workspaceId);
    this.chats.delete(workspaceId);
    return chat && chat.session ? this._end(chat.session) : Promise.resolve();
  }

  // Stops every process, interrupted ones included. Resolves when they are all gone.
  closeAll(): Promise<void> {
    this.chats.clear();
    return Promise.all([...this.live.keys()].map(session => session.close()))
      .then(() => (this.provider.close ? this.provider.close() : undefined));
  }
}
