'use strict';

const { spawn } = require('node:child_process');
const { createParser } = require('./claude-events.cjs');

// Agent provider for the installed Claude CLI.
//
// The provider interface, which a Codex provider would also implement:
//   provider.start({ cwd, resume, onEvent, onExit }) -> session
//   session.send(text)       writes one user message
//   session.interrupt()      ends the turn; the process stops and onEvent gets { type: 'interrupted' }
//   session.close()          stops the process without a visible event
//   session.alive            true until the process has exited
//   session.interrupting     true once interrupt() was called; the session takes no more messages
// Events are the chat events described in claude-events.cjs, plus
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

// How long a process may take to stop after SIGINT before it gets SIGTERM.
const INTERRUPT_GRACE_MS = 1500;

function createClaudeProvider({ bin = process.env.COD_CLAUDE_BIN || 'claude', env = process.env, graceMs = INTERRUPT_GRACE_MS } = {}) {
  function start({ cwd, resume, onEvent, onExit }) {
    const args = [...STREAMING_FLAGS];
    if (resume) args.push('--resume', resume);
    const parser = createParser();
    let alive = true;
    let interrupting = false;
    let turnActive = false;
    let errorSeen = false;
    let quiet = false;
    let stderr = '';
    let graceTimer = null;

    const emit = event => {
      if (quiet) return;
      if (event.type === 'turn-end') turnActive = false;
      if (event.type === 'error') { turnActive = false; errorSeen = true; }
      onEvent(event);
    };

    const child = spawn(bin, args, { cwd, env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { for (const event of parser.push(chunk)) emit(event); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', error => {
      if (!alive) return;
      alive = false;
      const missing = error.code === 'ENOENT';
      emit({
        type: 'error',
        kind: missing ? 'missing' : 'failed',
        message: missing ? 'Claude is not installed. Install the claude program and try again.' : `Could not start claude: ${error.message}`,
      });
      onExit();
    });
    child.on('close', code => {
      if (!alive) return;
      alive = false;
      clearTimeout(graceTimer);
      for (const event of parser.end()) emit(event);
      if (interrupting) {
        onEvent({ type: 'interrupted' });
      } else if (turnActive && !errorSeen) {
        const detail = stderr.trim();
        emit({ type: 'error', kind: 'failed', message: `Claude stopped unexpectedly (exit code ${code}).${detail ? `\n${detail}` : ''}` });
      }
      onExit();
    });

    return {
      get alive() { return alive; },
      get interrupting() { return interrupting; },
      send(text) {
        if (!alive || interrupting) return;
        turnActive = true;
        child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
      },
      interrupt() {
        if (!alive || interrupting) return;
        interrupting = true;
        // Anything the process still prints for this turn is dropped.
        quiet = true;
        child.kill('SIGINT');
        graceTimer = setTimeout(() => { if (alive) child.kill('SIGTERM'); }, graceMs);
      },
      close() {
        if (!alive) return;
        quiet = true;
        clearTimeout(graceTimer);
        child.stdin.end();
        child.kill('SIGTERM');
      },
    };
  }

  return { start };
}

module.exports = { createClaudeProvider, childEnv, CREDENTIAL_NAME, STREAMING_FLAGS };
