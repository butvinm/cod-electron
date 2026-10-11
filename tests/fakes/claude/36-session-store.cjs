#!/usr/bin/env node
'use strict';
// Story #36 only. Invented native-store records, never the operator's store.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const argv = process.argv.slice(2);
const config = process.env.CLAUDE_CONFIG_DIR;
const logFile = process.env.COD_FAKE_CLAUDE_LOG;
if (!config || !logFile) throw new Error('Story #36 requires fixture config and log');
const log = record => fs.appendFileSync(logFile, JSON.stringify({ pid: process.pid, ...record }) + '\n');
const option = name => argv[argv.indexOf(name) + 1];
log({ kind: 'start', argv, cwd: process.cwd() });
for (const [name, value] of [['--input-format', 'stream-json'], ['--output-format', 'stream-json']]) {
  if (!argv.includes(name) || option(name) !== value) throw new Error(`Expected ${name} ${value}`);
}
if (!argv.includes('-p') && !argv.includes('--print')) throw new Error('Expected print mode');
const session = argv.includes('--resume') ? option('--resume') : '550e8400-e29b-41d4-a716-446655440036';
if (!/^[a-f0-9-]{36}$/i.test(session)) throw new Error('Invalid session ID');
const directory = path.join(config, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
const file = path.join(directory, `${session}.jsonl`);
if (argv.includes('--resume') && !fs.existsSync(file)) throw new Error('Unknown fixture session');
fs.mkdirSync(directory, { recursive: true });
let parentUuid = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1)).uuid : null;
function save(type, message) {
  const uuid = randomUUID();
  fs.appendFileSync(file, JSON.stringify({ type, message, uuid, parentUuid, sessionId: session,
    cwd: process.cwd(), timestamp: new Date().toISOString(), version: '2.1.296', isSidechain: false, userType: 'external' }) + '\n');
  parentUuid = uuid;
  return uuid;
}
const emit = event => process.stdout.write(JSON.stringify({ session_id: session, ...event }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  log({ kind: 'stdin', line });
  const input = JSON.parse(line);
  if (input.type !== 'user' || input.message?.role !== 'user') throw new Error('Expected user input');
  const content = input.message.content;
  const prompt = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('');
  const uuid = save('user', { role: 'user', content: prompt });
  log({ kind: 'turn', session_id: session, prompt });
  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Read'], model: 'fake-claude', uuid });
  if (prompt === 'Read notes.txt live') {
    const tool = { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_live_36', name: 'Read', input: { file_path: 'notes.txt' } }] };
    emit({ type: 'assistant', message: tool, uuid: save('assistant', tool) });
    const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_live_36', content: 'Invented fixture contents.', is_error: false }] };
    emit({ type: 'user', message: result, uuid: save('user', result) });
  }
  const reply = prompt === 'Start in Cod' ? 'Started in Cod.' : prompt === 'Continue in terminal' ? 'Terminal continuation saved.' : prompt === 'Read notes.txt live' ? 'Read complete.' : 'Continued in Cod.';
  const message = { id: randomUUID(), type: 'message', role: 'assistant', model: 'fake-claude', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  emit({ type: 'assistant', message, uuid: save('assistant', message) });
  emit({ type: 'result', subtype: 'success', is_error: false, result: reply, uuid: randomUUID(), duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0 });
});
