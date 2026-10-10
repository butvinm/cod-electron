'use strict';

const os = require('node:os');

function permissionKey(event) {
  return JSON.stringify([event.tool, event.input]);
}

// One chat per workspace. Owns the agent session of each workspace and the choice of
// working directory. It talks to a provider (see claude.cjs) and reports plain events.
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
class Chats {
  constructor({ provider, folders, emit, home = os.homedir() }) {
    this.provider = provider;
    this.folders = folders;
    this.emit = emit;
    this.home = home;
    this.chats = new Map(); // workspace id -> { session, sessionId, cwd, busy }
    this.live = new Set();  // every session not yet gone, including interrupted ones
  }

  _wanted(workspaceId) {
    return this.folders.list(workspaceId)[0] || this.home;
  }

  // The directory Claude really runs in: the running process's, else the one the next message will use.
  info(workspaceId) {
    const chat = this.chats.get(workspaceId);
    const running = chat && chat.session && chat.session.alive && !chat.session.interrupting;
    const cwd = running ? chat.cwd : this._wanted(workspaceId);
    return { cwd, home: cwd === this.home };
  }

  _chat(workspaceId) {
    let chat = this.chats.get(workspaceId);
    if (!chat) {
      // allowed: requests approved for this session; asked: request id -> key of a request on screen.
      chat = { session: null, sessionId: null, cwd: null, busy: false, allowed: new Set(), asked: new Map() };
      this.chats.set(workspaceId, chat);
    }
    return chat;
  }

  // Ends an idle process whose directory is no longer the wanted one.
  _settle(workspaceId) {
    const chat = this.chats.get(workspaceId);
    if (!chat || !chat.session || chat.busy) return;
    if (chat.cwd !== this._wanted(workspaceId)) {
      const session = chat.session;
      chat.session = null;
      session.close();
    }
  }

  // The first folder of a workspace may have changed.
  foldersChanged(workspaceId) {
    this._settle(workspaceId);
  }

  send(workspaceId, text) {
    const chat = this._chat(workspaceId);
    this._settle(workspaceId);
    chat.busy = true;
    if (!chat.session || !chat.session.alive || chat.session.interrupting) {
      const cwd = this._wanted(workspaceId);
      const session = this.provider.start({
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

  // The answer to a permission request: { allow, message?, scope? }. Scope 'session' remembers
  // an allow for the same tool and input until the chat is forgotten.
  answerPermission(workspaceId, id, answer) {
    const chat = this.chats.get(workspaceId);
    if (!chat || !chat.session || !chat.asked.has(id)) return;
    const key = chat.asked.get(id);
    chat.asked.delete(id);
    if (answer.allow && answer.scope === 'session') chat.allowed.add(key);
    chat.session.answerPermission(id, { allow: answer.allow, message: answer.message });
  }

  interrupt(workspaceId) {
    this.chats.get(workspaceId)?.session?.interrupt();
  }

  forget(workspaceId) {
    const chat = this.chats.get(workspaceId);
    this.chats.delete(workspaceId);
    return chat && chat.session ? Promise.resolve(chat.session.close()) : Promise.resolve();
  }

  // Stops every process, interrupted ones included. Resolves when they are all gone.
  closeAll() {
    this.chats.clear();
    return Promise.all([...this.live].map(session => session.close()))
      .then(() => (this.provider.close ? this.provider.close() : undefined));
  }
}

module.exports = { Chats };
