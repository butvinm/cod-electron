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

// A provider whose processes end at once (delay false) or only when the test says so, like a real process.
function provider(delay = false): AgentProvider & { started: Fake[]; finish: () => void; maxAlive: () => number } {
  const started: Fake[] = [];
  const waiting: (() => void)[] = [];
  let most = 0;
  return {
    started,
    maxAlive: () => most,
    finish: () => { for (const done of waiting.splice(0)) done(); },
    start(options) {
      const session = {
        options, closed: 0, alive: true, interrupting: false,
        send() {}, interrupt() {}, answerPermission() {},
        close() {
          this.closed++;
          if (!delay) { this.alive = false; return; }
          return new Promise<void>(resolve => waiting.push(() => { this.alive = false; options.onExit(); resolve(); }));
        },
      } as Fake;
      started.push(session);
      most = Math.max(most, started.filter(candidate => candidate.alive).length);
      return session;
    },
  };
}

const command = "cd '/proj/a' && claude --resume sid";
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function idleChat(fake: ReturnType<typeof provider>): Chats {
  const chats = new Chats({ provider: fake, folders: { list: () => ['/proj/a'] }, emit: () => {}, home: '/home/me' });
  chats.send('w1', 'hi');
  fake.started[0].options.onEvent({ type: 'session', id: 'sid' });
  fake.started[0].options.onEvent({ type: 'turn-end' });
  return chats;
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
  assert.equal(await chats.handoff('w1'), command);
  assert.equal(fake.started[0].closed, 1);
  chats.send('w1', 'again');
  assert.equal(fake.started.length, 2);
  assert.equal(fake.started[1].options.resume, 'sid');
  assert.equal(fake.started[1].options.cwd, '/proj/a');
});

test('handoff twice quickly returns the command only after the process is gone', async () => {
  const fake = provider(true);
  const chats = idleChat(fake);
  const settled: string[] = [];
  const first = chats.handoff('w1').then(value => { settled.push('first'); return value; });
  const second = chats.handoff('w1').then(value => { settled.push('second'); return value; });
  await tick();
  assert.deepEqual(settled, []);
  fake.finish();
  assert.deepEqual(await Promise.all([first, second]), [command, command]);
  assert.equal(fake.started[0].alive, false);
});

test('handoff then send right away starts the new process only after the old one exited', async () => {
  const fake = provider(true);
  const chats = idleChat(fake);
  const handed = chats.handoff('w1');
  chats.send('w1', 'again');
  await tick();
  assert.equal(fake.started.length, 1);
  fake.finish();
  await handed;
  await tick();
  assert.equal(fake.started.length, 2);
  assert.equal(fake.started[1].options.resume, 'sid');
  assert.equal(fake.maxAlive(), 1);
});

test('handoff, then two overlapping opens of the same session, then handoff waits for the first process', async () => {
  const fake = provider(true);
  const chats = idleChat(fake);
  chats.handoff('w1');
  const settled: string[] = [];
  const openA = chats.open('w1', 'sid', '/proj/a').then(() => { settled.push('openA'); });
  await chats.open('w1', 'sid', '/proj/a'); // the second open does not wait for the first process
  const again = chats.handoff('w1').then(value => { settled.push('handoff'); return value; });
  await tick();
  assert.deepEqual(settled.filter(name => name === 'handoff'), [], 'the command is not returned while the process is alive');
  assert.equal(fake.started[0].alive, true);
  fake.finish();
  await openA;
  assert.equal(await again, command);
  assert.equal(fake.started[0].alive, false);
});

test('handoff, then two overlapping opens, then send starts one process, after the first exited', async () => {
  const fake = provider(true);
  const chats = idleChat(fake);
  chats.handoff('w1');
  const openA = chats.open('w1', 'sid', '/proj/a');
  const openB = chats.open('w1', 'sid', '/proj/a');
  await openB; // the second open does not wait for the first process
  chats.send('w1', 'again');
  await tick();
  assert.equal(fake.started.length, 1, 'no second process while the first is alive');
  fake.finish();
  await Promise.all([openA, openB]);
  await tick();
  assert.equal(fake.started.length, 2);
  assert.equal(fake.started[1].options.resume, 'sid');
  assert.equal(fake.maxAlive(), 1);
});
