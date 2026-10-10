'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// A temporary MCP peer tests the fake, never replaces Cod's real permission host.
const peer = `
const readline = require('node:readline');
const fs = require('node:fs');
const batch = [];
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(process.env.PEER_LOG, line + '\\n');
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'approve', inputSchema: { type: 'object' } }] };
  else if (request.method === 'tools/call') {
    if (request.params.name !== 'approve') throw new Error('Wrong tool');
    const answer = process.env.ANSWER === 'deny' ? { behavior: 'deny', message: 'Do not run "printf"\\nKeep fixture unchanged.' } : { behavior: 'allow', updatedInput: request.params.arguments.input };
    result = { content: [{ type: 'text', text: JSON.stringify(answer) }] };
  } else throw new Error('Unexpected method');
  const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n';
  if (process.env.BATCH === 'true' && request.method === 'tools/call') {
    batch.push(response);
    if (batch.length === 2) process.stdout.write(batch.join(''));
  } else process.stdout.write(response);
});`;

async function run(t, scenario, permission, configFile = false, prompts = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-fake-protocol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gates = path.join(dir, 'gates'); fs.mkdirSync(gates);
  fs.writeFileSync(path.join(gates, 'finish'), 'release');
  const log = path.join(dir, 'claude.jsonl');
  const peerLog = path.join(dir, 'peer.jsonl');
  const server = path.join(dir, 'server.cjs'); fs.writeFileSync(server, peer);
  const config = { mcpServers: { fixture: { command: process.execPath, args: [server], env: { PEER_LOG: peerLog, ANSWER: permission, BATCH: String(scenario === 'permissions-queued') } } } };
  const configPath = path.join(dir, 'mcp.json'); fs.writeFileSync(configPath, JSON.stringify(config));
  const argv = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (permission) argv.push('--permission-prompt-tool', 'mcp__fixture__approve', '--mcp-config', configFile ? configPath : JSON.stringify(config));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(ANTHROPIC_|CLAUDE_)/.test(name)));
  const child = spawn(path.join(__dirname, 'claude'), argv, { env: { ...env, COD_FAKE_CLAUDE_LOG: log, COD_FAKE_CLAUDE_SCENARIO: scenario, COD_FAKE_CLAUDE_GATES: gates } });
  t.after(() => child.kill());
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Fake timed out')); }, 5000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
  const messages = Array.from({ length: prompts }, () => JSON.stringify({ type: 'user', message: { role: 'user', content: 'Invented fixture prompt' } })).join('\n') + '\n';
  if (scenario === 'interrupt') child.stdout.on('data', () => { if (stdout.includes('Still working')) child.kill('SIGTERM'); });
  child.stdin.end(messages);
  const completed = await result;
  const lines = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return { ...completed, records: lines(log), wire: completed.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), peer: lines(peerLog) };
}

for (const scenario of ['reply', 'tools', 'stream', 'not-logged-in', 'interrupt']) test(`#8 ${scenario} remains unchanged without permission flags`, async t => {
  const result = await run(t, scenario);
  assert.equal(result.stderr, '');
  assert.equal(result.code, scenario === 'not-logged-in' ? 1 : scenario === 'interrupt' ? 143 : 0);
  assert.equal(result.records.some(record => record.kind.startsWith('permission-') || record.kind === 'mcp-connect'), false);
  if (scenario === 'interrupt') assert.equal(result.wire.some(event => event.type === 'result'), false);
  else assert.equal(result.wire.at(-1).type, 'result');
});

for (const configFile of [false, true]) for (const behavior of ['allow', 'deny']) test(`MCP ${behavior}, ${configFile ? 'file' : 'inline'} config, two identical requests`, async t => {
  const result = await run(t, 'permissions', behavior, configFile, 2);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.peer[0].method, 'initialize');
  assert.equal(result.peer[1].method, 'notifications/initialized');
  assert.equal(result.peer[2].method, 'tools/list');
  const calls = result.peer.filter(record => record.method === 'tools/call');
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(call.params, { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'printf cod-permission-fixture' } } });
  const answers = result.records.filter(record => record.kind === 'permission-answer');
  assert.equal(answers.length, 2);
  assert.equal(answers[0].tool, 'mcp__fixture__approve');
  assert.equal(answers[0].answer.behavior, behavior);
  assert.equal(result.records.filter(record => record.kind === 'tool-run').length, behavior === 'allow' ? 2 : 0);
  const final = result.wire.filter(event => event.type === 'result');
  assert.equal(final.length, 2);
  assert.equal(final[0].result, behavior === 'allow' ? 'Allowed command complete.' : 'Denied command: Do not run "printf"\nKeep fixture unchanged.');
  const requestIndex = result.records.findIndex(record => record.kind === 'permission-request');
  const answerIndex = result.records.findIndex(record => record.kind === 'permission-answer');
  const toolIndex = result.records.findIndex(record => record.kind === 'tool-run');
  assert.ok(requestIndex < answerIndex);
  if (behavior === 'allow') assert.ok(answerIndex < toolIndex);
  assert.equal(result.records.filter(record => record.kind === 'stdin').length, 2);
});


test('queued permissions send two distinct MCP calls before either answer in one turn', async t => {
  // The peer withholds both answers until both calls arrive. Sequential calls time out.
  const result = await run(t, 'permissions-queued', 'allow');
  assert.equal(result.code, 0, result.stderr);
  const requests = result.records.filter(record => record.kind === 'permission-request');
  const expected = [
    { tool_name: 'Bash', input: { command: 'printf cod-permission-fixture' } },
    { tool_name: 'Bash', input: { command: 'printf cod-permission-second' } },
  ];
  assert.deepEqual(requests.map(record => record.request), expected);
  assert.deepEqual(result.records.filter(record => record.kind === 'permission-answer').map(record => record.request), expected);
  const firstAnswer = result.records.findIndex(record => record.kind === 'permission-answer');
  const secondRequest = result.records.indexOf(requests[1]);
  assert.ok(secondRequest < firstAnswer, 'Both requests must arrive before the first answer');
  assert.equal(result.records.filter(record => record.kind === 'turn').length, 1);
  assert.equal(result.records.filter(record => record.kind === 'tool-run').length, 2);
  assert.equal(result.wire.filter(event => event.type === 'result').length, 1);
});
