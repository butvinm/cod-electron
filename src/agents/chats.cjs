'use strict';

const os = require('node:os');

// One chat per workspace. Owns the agent session of each workspace and the choice of
// working directory. It talks to a provider (see claude.cjs) and reports plain events.
//
// emit(workspaceId, event) receives every event of every chat.
class Chats {
  constructor({ provider, folders, emit, home = os.homedir() }) {
    this.provider = provider;
    this.folders = folders;
    this.emit = emit;
    this.home = home;
    this.chats = new Map(); // workspace id -> { session, sessionId }
  }

  // The first folder of the workspace, or the user's home directory when it has none.
  info(workspaceId) {
    const first = this.folders.list(workspaceId)[0];
    return first ? { cwd: first, home: false } : { cwd: this.home, home: true };
  }

  _chat(workspaceId) {
    let chat = this.chats.get(workspaceId);
    if (!chat) {
      chat = { session: null, sessionId: null };
      this.chats.set(workspaceId, chat);
    }
    return chat;
  }

  send(workspaceId, text) {
    const chat = this._chat(workspaceId);
    if (!chat.session || !chat.session.alive || chat.session.interrupting) {
      const session = this.provider.start({
        cwd: this.info(workspaceId).cwd,
        // A process that ended (after an interrupt, say) is replaced by one that resumes the same session.
        resume: chat.sessionId || undefined,
        onEvent: event => {
          // The interrupted marker of an older process still counts.
          if (chat.session !== session && event.type !== 'interrupted') return;
          if (event.type === 'session') chat.sessionId = event.id;
          this.emit(workspaceId, event);
        },
        onExit: () => { if (chat.session === session) chat.session = null; },
      });
      chat.session = session;
    }
    chat.session.send(text);
  }

  interrupt(workspaceId) {
    this.chats.get(workspaceId)?.session?.interrupt();
  }

  forget(workspaceId) {
    const chat = this.chats.get(workspaceId);
    if (chat && chat.session) chat.session.close();
    this.chats.delete(workspaceId);
  }

  closeAll() {
    for (const id of [...this.chats.keys()]) this.forget(id);
  }
}

module.exports = { Chats };
