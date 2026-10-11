import test from 'node:test';
import assert from 'node:assert/strict';
import { Chats } from '../../src/agents/chats.ts';
import { resumeCommand, shellQuote } from '../../src/agents/handoff.ts';
import type { AgentProvider, AgentSession, StartOptions } from '../../src/agents/provider.ts';

test('shellQuote wraps in single quotes and escapes embedded single quotes', () => {
  assert.equal(shellQuote('/a b/c'), "'/a b/c'");
  assert.equal(shellQuote("/it's/here"), `'/it'\\''s/here'`);
  assert.equal(shellQuote('$HOME `x` "y"'), `'$HOME \`x\` "y"'`);
});

test('resumeCommand changes folder and resumes the session', () => {
  assert.equal(resumeCommand('/p/terminal orchard', 'abc-1'), "cd '/p/terminal orchard' && claude --resume abc-1");
});

interface Fake extends AgentSession { options: StartOptions; closed: number; alive: boolean; interrupting: boolean }

function provider(): AgentProvider & { started: Fake[] } {
  const started: Fake[] = [];
  return {
    started,
    start(options) {
      const session = {
        options, closed: 0, alive: true, interrupting: false,
        send() {}, interrupt() {}, answerPermission() {},
        close() { this.closed++; this.alive = false; },
      } as Fake;
      started.push(session);
      return session;
    },
  };
}

test('Chats.handoff gives the command, ends the idle process and the next send resumes in the same folder', async () => {
  const fake = provider();
  const chats = new Chats({ provider: fake, folders: { list: () => ['/proj/a'] }, emit: () => {}, home: '/home/me' });
  assert.equal(await chats.handoff('w1'), null);
  chats.send('w1', 'hi');
  fake.started[0].options.onEvent({ type: 'session', id: 'sid' });
  assert.equal(await chats.handoff('w1'), null, 'busy: nothing happens');
  assert.equal(fake.started[0].closed, 0);
  fake.started[0].options.onEvent({ type: 'turn-end' });
  assert.equal(await chats.handoff('w1'), "cd '/proj/a' && claude --resume sid");
  assert.equal(fake.started[0].closed, 1);
  chats.send('w1', 'again');
  assert.equal(fake.started.length, 2);
  assert.equal(fake.started[1].options.resume, 'sid');
  assert.equal(fake.started[1].options.cwd, '/proj/a');
});

test('Chats.handoff called twice quickly returns the command only after the process is gone', async () => {
  let finish = () => {};
  const fake = provider();
  const start = fake.start.bind(fake);
  fake.start = options => {
    const session = start(options) as Fake;
    session.close = () => new Promise<void>(resolve => { finish = () => { session.alive = false; resolve(); }; });
    return session;
  };
  const chats = new Chats({ provider: fake, folders: { list: () => ['/proj/a'] }, emit: () => {}, home: '/home/me' });
  chats.send('w1', 'hi');
  fake.started[0].options.onEvent({ type: 'session', id: 'sid' });
  fake.started[0].options.onEvent({ type: 'turn-end' });
  const settled: string[] = [];
  const first = chats.handoff('w1').then(value => { settled.push('first'); return value; });
  const second = chats.handoff('w1').then(value => { settled.push('second'); return value; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(settled, []);
  finish();
  const command = "cd '/proj/a' && claude --resume sid";
  assert.deepEqual(await Promise.all([first, second]), [command, command]);
});
