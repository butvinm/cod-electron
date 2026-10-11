import type { ChatEvent } from '../shared/chat.ts';

// The provider interface, which a Codex provider would also implement.
// Events are the chat events of src/shared/chat.ts. Only plain data crosses this interface,
// so the process could later run behind a socket.
export interface AgentSession {
  // Writes one user message.
  send(text: string): void;
  // Ends the turn; the process stops and onEvent gets { type: 'interrupted' }.
  interrupt(): void;
  // Replies to a 'permission-request' event. Claude waits until this is called.
  // answers is set for AskUserQuestion: the session returns it with the question input.
  answerPermission(id: string, answer: { allow: boolean; message?: string; answers?: Record<string, string> }): void;
  // Stops the process without a visible event. The promise resolves once it and everything it started is gone.
  close(): Promise<void> | void;
  // True until the process has exited.
  readonly alive: boolean;
  // True once interrupt() was called; the session takes no more messages.
  readonly interrupting: boolean;
}

export interface StartOptions {
  cwd: string;
  resume?: string;
  onEvent: (event: ChatEvent) => void;
  onExit: () => void;
}

export interface AgentProvider {
  start(options: StartOptions): AgentSession;
  close?(): Promise<void> | void;
}
