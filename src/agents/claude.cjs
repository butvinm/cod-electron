'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { createParser } = require('./claude-events.cjs');
const { createPermissionHost } = require('./permission-host.cjs');

// Agent provider for the installed Claude CLI.
//
// The provider interface, which a Codex provider would also implement:
//   provider.start({ cwd, resume, onEvent, onExit }) -> session
//   session.send(text)       writes one user message
//   session.interrupt()      ends the turn; the process stops and onEvent gets { type: 'interrupted' }
//   session.answerPermission(id, { allow, message })   replies to a 'permission-request' event
//   session.close()        stops the process without a visible event
//   session.alive            true until the process has exited
//   session.interrupting     true once interrupt() was called; the session takes no more messages
// Events are the chat events described in claude-events.cjs, plus
//   { type: 'permission-request', id, tool, input }  Claude waits until answerPermission(id, ...) is called
//   { type: 'permission-clear', id }                 the request went away without an answer
//   { type: 'interrupted' } and { type: 'error', kind: 'missing', message }.
// Only plain data crosses this interface, so the process could later run behind a socket.

const STREAMING_FLAGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

// Cod never reads, stores or passes login tokens. The CLI owns the login, so credential
// variables from Cod's own environment are not handed on, and bare mode is never enabled.
const CREDENTIAL_NAME = /^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i;

function childEnv(source) {
  const env = {};
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

function createClaudeProvider({ bin = process.env.COD_CLAUDE_BIN || 'claude', env = process.env, graceMs = INTERRUPT_GRACE_MS, onArrival = () => {} } = {}) {
  // onArrival({ id, rpcId }) is called when a permission request reaches the server, before it is shown. Tests use it.
  // Permission requests arrive through a small local MCP server (see permission-host.cjs).
  const host = createPermissionHost();

  function start({ cwd, resume, onEvent, onExit }) {
    const args = [...STREAMING_FLAGS];
    if (resume) args.push('--resume', resume);
    const permissions = new Map(); // request id -> { input, resolve }
    const registration = host.register((request, signal) => new Promise(resolve => {
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
    let flushTimer = null;
    const arrivals = [];
    function flushArrivals() {
      flushTimer = null;
      const batch = arrivals.splice(0).sort((a, b) => (typeof a.rpcId === 'number' && typeof b.rpcId === 'number' ? a.rpcId - b.rpcId : 0));
      for (const { id, tool, input } of batch) if (permissions.has(id)) emit({ type: 'permission-request', id, tool, input });
    }
    if (registration) args.push('--mcp-config', registration.config, '--permission-prompt-tool', registration.tool);
    const denyAll = message => {
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
    let timers = [];
    let finished;
    const exited = new Promise(resolve => { finished = resolve; });

    // The process runs in its own group, so signals reach the tools it started too.
    const signalTree = signal => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already gone */ }
    };

    const emit = event => {
      if (quiet) return;
      if (event.type === 'turn-end') turnActive = false;
      if (event.type === 'error') { turnActive = false; errorSeen = true; }
      onEvent(event);
    };

    const child = spawn(bin, args, { cwd, env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { for (const event of parser.push(chunk)) emit(event); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', error => {
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
    function finish(code) {
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

    function stop(signals) {
      timers.forEach(clearTimeout);
      timers = signals.map((signal, index) => setTimeout(() => signalTree(signal), index * graceMs));
      timers.push(setTimeout(() => finish(null), signals.length * graceMs));
    }

    return {
      get alive() { return alive; },
      get interrupting() { return interrupting; },
      // Resolves once the process and everything it started is gone.
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

module.exports = { createClaudeProvider, childEnv, CREDENTIAL_NAME, STREAMING_FLAGS };
