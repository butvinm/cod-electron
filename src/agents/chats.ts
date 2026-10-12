import os from 'node:os';
import type { ChatEvent, ChatInfo, PermissionAnswer, PermissionMode } from '../shared/chat.ts';
import type { AgentProvider, AgentSession } from './provider.ts';
import { resumeCommand } from './handoff.ts';

function permissionKey(event: { tool: string; input: unknown }): string {
  return JSON.stringify([event.tool, event.input]);
}

interface Chat {
  // The shutdown of a process ended by Continue in Terminal, while it is under way.
  closing?: Promise<void> | null;
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
  live = new Set<AgentSession>();

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
      session.close();
    }
  }

  // The first folder of a workspace may have changed.
  foldersChanged(workspaceId: string): void {
    this._settle(workspaceId);
  }

  send(workspaceId: string, text: string): void {
    const chat = this._chat(workspaceId);
    this._settle(workspaceId);
    chat.busy = true;
    if (!chat.session || !chat.session.alive || chat.session.interrupting) {
      const cwd = this._wanted(workspaceId);
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
          this.live.delete(session);
          if (chat.session === session) { chat.session = null; chat.busy = false; }
        },
      });
      chat.session = session;
      chat.cwd = cwd;
      this.live.add(session);
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
  handoff(workspaceId: string): Promise<string | null> {
    const chat = this.chats.get(workspaceId);
    if (!chat || chat.busy || !chat.sessionId) return Promise.resolve(null);
    const command = resumeCommand(chat.cwd ?? this._wanted(workspaceId), chat.sessionId);
    const session = chat.session;
    if (session) {
      chat.session = null;
      // Overlapping handoffs all wait for the same shutdown.
      chat.closing = Promise.resolve(session.close()).then(() => { chat.closing = null; });
    }
    return Promise.resolve(chat.closing).then(() => command);
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
    // A process ended by Continue in Terminal may still be shutting down: wait for it too.
    if (!chat.session) return Promise.resolve(chat.closing ?? undefined);
    // Detach first, so late events of the old process never reach the new chat.
    const session = chat.session;
    chat.session = null;
    chat.busy = false;
    chat.asked.clear();
    return Promise.all([session.close(), chat.closing]).then(() => {});
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
    if (!chat) return Promise.resolve();
    return Promise.all([chat.session ? chat.session.close() : undefined, chat.closing]).then(() => {});
  }

  // Stops every process, interrupted ones included. Resolves when they are all gone.
  closeAll(): Promise<void> {
    this.chats.clear();
    return Promise.all([...this.live].map(session => session.close()))
      .then(() => (this.provider.close ? this.provider.close() : undefined));
  }
}
