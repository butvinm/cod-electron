import os from 'node:os';
import type { ChatEvent, ChatInfo, PermissionAnswer } from '../shared/chat.ts';
import type { AgentProvider, AgentSession } from './provider.ts';

function permissionKey(event: { tool: string; input: unknown }): string {
  return JSON.stringify([event.tool, event.input]);
}

interface Chat {
  session: AgentSession | null;
  sessionId: string | null;
  cwd: string | null;
  busy: boolean;
  // Requests approved for this session.
  allowed: Set<string>;
  // Request id -> key of a request on screen.
  asked: Map<string, string>;
}

export interface ChatsOptions {
  provider: AgentProvider;
  folders: { list: (workspaceId: string) => string[] };
  emit: (workspaceId: string, event: ChatEvent) => void;
  home?: string;
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
  defaultFolder: NonNullable<ChatsOptions['defaultFolder']>;
  chats = new Map<string, Chat>();
  // Every session not yet gone, including interrupted ones.
  live = new Set<AgentSession>();

  constructor({ provider, folders, emit, home = os.homedir(), defaultFolder = () => ({ folder: null, notice: null }) }: ChatsOptions) {
    this.defaultFolder = defaultFolder;
    this.provider = provider;
    this.folders = folders;
    this.emit = emit;
    this.home = home;
  }

  // First folder of the workspace, else the settings' default folder, else home.
  _choice(workspaceId: string): { cwd: string; notice: string | null } {
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
      chat = { session: null, sessionId: null, cwd: null, busy: false, allowed: new Set(), asked: new Map() };
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
        onEvent: event => {
          // The interrupted marker of an older process still counts.
          if (chat.session !== session && event.type !== 'interrupted') return;
          if (event.type === 'session') chat.sessionId = event.id;
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
    chat.session.answerPermission(id, { allow: answer.allow, message: answer.message });
  }

  interrupt(workspaceId: string): void {
    this.chats.get(workspaceId)?.session?.interrupt();
  }

  // New Claude Chat: the old process ends and the next message starts a new session (no resume).
  // The old session stays on disk for the CLI.
  reset(workspaceId: string): Promise<void> {
    const chat = this.chats.get(workspaceId);
    this.chats.delete(workspaceId);
    if (!chat || !chat.session) return Promise.resolve();
    // Detach first, so late events of the old process never reach the new chat.
    const session = chat.session;
    chat.session = null;
    chat.busy = false;
    chat.asked.clear();
    return Promise.resolve(session.close());
  }

  forget(workspaceId: string): Promise<void> {
    const chat = this.chats.get(workspaceId);
    this.chats.delete(workspaceId);
    return chat && chat.session ? Promise.resolve(chat.session.close()) : Promise.resolve();
  }

  // Stops every process, interrupted ones included. Resolves when they are all gone.
  closeAll(): Promise<void> {
    this.chats.clear();
    return Promise.all([...this.live].map(session => session.close()))
      .then(() => (this.provider.close ? this.provider.close() : undefined));
  }
}
