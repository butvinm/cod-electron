import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import type { ChatEvent } from '../shared/chat.ts';
import { createParser } from './claude-events.ts';
import { createPermissionHost, type PermissionReply } from './permission-host.ts';
import type { AgentProvider, AgentSession, StartOptions } from './provider.ts';

// Agent provider for the installed Claude CLI. It implements AgentProvider (see provider.ts).
// Events are the chat events described in src/shared/chat.ts and claude-events.ts, plus
//   { type: 'error', kind: 'missing', message } when the program is not installed.

export const STREAMING_FLAGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

// Cod never reads, stores or passes login tokens. The CLI owns the login, so credential
// variables from Cod's own environment are not handed on, and bare mode is never enabled.
export const CREDENTIAL_NAME = /^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i;

export function childEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (CREDENTIAL_NAME.test(name) || name === 'CLAUDE_CODE_SIMPLE') continue;
    env[name] = value;
  }
  return env;
}

// How long a process may take to stop after each signal before the next, harder one.
// Shutdown is bounded: SIGINT (interrupt only), SIGTERM, SIGKILL, then the session is
// declared over even if the operating system never confirms the exit.
const INTERRUPT_GRACE_MS = 1500;
const ARRIVAL_WINDOW_MS = 30;

export interface ClaudeProviderOptions {
  bin?: string;
  env?: NodeJS.ProcessEnv;
  graceMs?: number;
  // Called when a permission request reaches the server, before it is shown. Tests use it.
  onArrival?: (arrival: { id: string; rpcId: string | number | null | undefined }) => void;
}

export interface ClaudeProvider extends AgentProvider {
  start(options: StartOptions): ClaudeSession;
  ready: Promise<number | null>;
  endpointCount(): number;
  close(): Promise<void>;
}

export interface ClaudeSession extends AgentSession {
  // Resolves once the process and everything it started is gone.
  exited: Promise<void>;
  close(): Promise<void>;
}

interface Arrival {
  id: string;
  rpcId: string | number | null | undefined;
  tool: string;
  input: unknown;
}

export function createClaudeProvider({ bin = process.env.COD_CLAUDE_BIN || 'claude', env = process.env, graceMs = INTERRUPT_GRACE_MS, onArrival = () => {} }: ClaudeProviderOptions = {}): ClaudeProvider {
  // Permission requests arrive through a small local MCP server (see permission-host.ts).
  const host = createPermissionHost();

  function start({ cwd, resume, onEvent, onExit }: StartOptions): ClaudeSession {
    const args = [...STREAMING_FLAGS];
    if (resume) args.push('--resume', resume);
    const permissions = new Map<string, { input: unknown; resolve: (reply: PermissionReply) => void }>();
    const registration = host.register((request, signal) => new Promise<PermissionReply>(resolve => {
      if (!alive || quiet) { resolve({ behavior: 'deny', message: 'Cod is not taking requests right now.' }); return; }
      const id = crypto.randomUUID();
      permissions.set(id, { input: request.input, resolve });
      signal.addEventListener('abort', () => {
        if (permissions.delete(id)) emit({ type: 'permission-clear', id });
        resolve({ behavior: 'deny', message: 'The request was cancelled.' });
      });
      // Concurrent calls can reach the server out of order. Requests that arrive within a
      // few milliseconds are shown in the order Claude made them (JSON-RPC ids increase).
      arrivals.push({ id, rpcId: request.rpcId, tool: request.tool_name, input: request.input });
      onArrival({ id, rpcId: request.rpcId });
      if (!flushTimer) flushTimer = setTimeout(flushArrivals, ARRIVAL_WINDOW_MS);
    }));
    let flushTimer: NodeJS.Timeout | null = null;
    const arrivals: Arrival[] = [];
    function flushArrivals(): void {
      flushTimer = null;
      const batch = arrivals.splice(0).sort((a, b) => (typeof a.rpcId === 'number' && typeof b.rpcId === 'number' ? a.rpcId - b.rpcId : 0));
      for (const { id, tool, input } of batch) if (permissions.has(id)) emit({ type: 'permission-request', id, tool, input });
    }
    if (registration) args.push('--mcp-config', registration.config, '--permission-prompt-tool', registration.tool);
    const denyAll = (message: string): void => {
      for (const entry of permissions.values()) entry.resolve({ behavior: 'deny', message });
      permissions.clear();
    };
    const parser = createParser();
    let alive = true;
    let interrupting = false;
    let turnActive = false;
    let errorSeen = false;
    let quiet = false;
    let stderr = '';
    let timers: NodeJS.Timeout[] = [];
    let finished: () => void = () => {};
    const exited = new Promise<void>(resolve => { finished = resolve; });

    // The process runs in its own group, so signals reach the tools it started too.
    const signalTree = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already gone */ }
    };

    const emit = (event: ChatEvent): void => {
      if (quiet) return;
      if (event.type === 'turn-end') turnActive = false;
      if (event.type === 'error') { turnActive = false; errorSeen = true; }
      onEvent(event);
    };

    const child = spawn(bin, args, { cwd, env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { for (const event of parser.push(chunk)) emit(event); });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (!alive) return;
      alive = false;
      timers.forEach(clearTimeout);
      denyAll('The Claude session ended.');
      if (registration) registration.unregister();
      const missing = error.code === 'ENOENT';
      emit({
        type: 'error',
        kind: missing ? 'missing' : 'failed',
        message: missing ? 'Claude is not installed. Install the claude program and try again.' : `Could not start claude: ${error.message}`,
      });
      onExit();
      finished();
    });

    // The session is over: nothing it started may outlive it, and the chat always hears about it.
    function finish(code: number | null): void {
      if (!alive) return;
      alive = false;
      timers.forEach(clearTimeout);
      denyAll('The Claude session ended.');
      if (registration) registration.unregister();
      signalTree('SIGKILL');
      for (const event of parser.end()) emit(event);
      if (interrupting) {
        onEvent({ type: 'interrupted' });
      } else if (turnActive && !errorSeen && !quiet) {
        const detail = stderr.trim();
        emit({ type: 'error', kind: 'failed', message: `Claude stopped unexpectedly (exit code ${code}).${detail ? `\n${detail}` : ''}` });
      }
      onExit();
      finished();
    }
    child.on('close', finish);
    // Tools that outlive the process can hold its pipes open, so do not wait for 'close' alone.
    child.on('exit', code => { if (alive) timers.push(setTimeout(() => finish(code), 200)); });

    function stop(signals: NodeJS.Signals[]): void {
      timers.forEach(clearTimeout);
      timers = signals.map((signal, index) => setTimeout(() => signalTree(signal), index * graceMs));
      timers.push(setTimeout(() => finish(null), signals.length * graceMs));
    }

    return {
      get alive() { return alive; },
      get interrupting() { return interrupting; },
      exited,
      send(text) {
        if (!alive || interrupting) return;
        turnActive = true;
        child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
      },
      answerPermission(id, { allow, message }) {
        const entry = permissions.get(id);
        if (!entry) return;
        permissions.delete(id);
        entry.resolve(allow
          ? { behavior: 'allow', updatedInput: entry.input }
          : { behavior: 'deny', message: typeof message === 'string' && message ? message : 'The user denied this request.' });
      },
      interrupt() {
        if (!alive || interrupting) return;
        interrupting = true;
        denyAll('The user interrupted.');
        // Anything the process still prints for this turn is dropped.
        quiet = true;
        stop(['SIGINT', 'SIGTERM', 'SIGKILL']);
      },
      // Stops the process without a visible event. Returns a promise for the exit.
      close() {
        if (!alive) return exited;
        quiet = true;
        denyAll('The chat was closed.');
        child.stdin.end();
        stop(['SIGTERM', 'SIGKILL']);
        return exited;
      },
    };
  }

  return { start, ready: host.ready, endpointCount: () => host.count(), close: () => host.close() };
}
