#!/usr/bin/env node
'use strict';
// Story #33 only. The shared fake and its other scenarios are unchanged.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const argv = process.argv.slice(2);
const option = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const logFile = process.env.COD_FAKE_CLAUDE_LOG;
const gates = process.env.COD_FAKE_CLAUDE_GATES;
const log = record => fs.appendFileSync(logFile, JSON.stringify({ pid: process.pid, ...record }) + '\n');
const session = option('--session-id') || option('--resume') || '550e8400-e29b-41d4-a716-446655440033';
let mode = option('--permission-mode') || 'manual';
const emit = event => {
  process.stdout.write(JSON.stringify(event) + '\n');
  log({ kind: 'emit', event });
};
log({ kind: 'start', argv });
for (const [name, value] of [['--input-format', 'stream-json'], ['--output-format', 'stream-json']]) {
  if (option(name) !== value) throw new Error(`Expected ${name} ${value}`);
}
if (!(argv.includes('-p') || argv.includes('--print')) || !argv.includes('--verbose') || !argv.includes('--include-partial-messages')) {
  throw new Error('Expected print mode, --verbose and --include-partial-messages');
}
function gate(name) {
  return new Promise(resolve => {
    const file = path.join(gates, name);
    // Poll a release file rather than using an OS directory watcher. Some QA
    // hosts cannot allocate fs.watch handles; release still depends only on data.
    const ready = () => { if (fs.existsSync(file)) { fs.unwatchFile(file, ready); resolve(); } };
    fs.watchFile(file, { interval: 50 }, ready);
    ready();
    log({ kind: 'gate', name });
  });
}
async function turn(input) {
  if (input.message?.role !== 'user') throw new Error('Expected user message');
  emit({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [], model: 'fake-claude', permissionMode: mode, uuid: randomUUID() });
  const steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenarios/stream.json'), 'utf8')).turns[0];
  for (const step of steps.slice(1)) {
    if (step.gate) {
      if (process.env.COD_FAKE_CLAUDE_MODE_REPORT === '1') {
        await gate('report-mode');
        mode = 'manual';
        emit({ type: 'system', subtype: 'status', status: null, permissionMode: mode, session_id: session, uuid: randomUUID() });
        log({ kind: 'mode-report', mode });
      }
      await gate('finish');
    } else if (step.event) {
      emit(JSON.parse(JSON.stringify(step.event, (_key, value) => value === '$SESSION' ? session : value === '$UUID' ? randomUUID() : value)));
    }
  }
}
// Control requests must be handled while the scripted turn is waiting at a gate.
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  if (!line.trim()) return;
  log({ kind: 'stdin', line });
  try {
    const message = JSON.parse(line);
    if (message.type === 'control_request') {
      log({ kind: 'control-request', request_id: message.request_id, request: message.request });
      if (message.request?.subtype === 'set_permission_mode') mode = message.request.mode;
      emit({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
    } else if (message.type === 'user') {
      void turn(message).catch(error => { log({ kind: 'error', message: error.message }); process.exit(2); });
    } else throw new Error('Expected user or control_request');
  } catch (error) { log({ kind: 'error', message: error.message }); process.exit(2); }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  log({ kind: 'signal', signal });
  process.exit(signal === 'SIGINT' ? 130 : 143);
});
