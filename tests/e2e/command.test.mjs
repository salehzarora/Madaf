import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { getEventListeners } from 'node:events';
import { runOwnedCommand, runWithCleanup } from '../../scripts/e2e-command.mjs';

const windows = process.platform === 'win32';
const options = { cwd: process.cwd(), env: process.env, phase: 'synthetic-process', timeout: windows ? 8_000 : 2_000, grace: 100, hardWait: 2_000 };
const deadline = windows ? 2_500 : 600;
const execute = (code, extra = {}) => runOwnedCommand(process.execPath, ['--input-type=module', '-e', code], { ...options, ...extra });

test('owned command succeeds normally and rejects nonzero exit without leaking output', async () => {
  assert.equal(await execute("console.log('NORMAL')"), 'NORMAL\n');
  await assert.rejects(execute("console.error('private synthetic detail'); process.exit(7)"), error => {
    assert.match(error.message, /synthetic-process failed/);
    assert(!error.message.includes('private synthetic detail'));
    assert.equal(error.exitCode, 7);
    return true;
  });
});

test('timeout rejects even when SIGTERM handler exits zero', async () => {
  let output = '';
  await assert.rejects(execute(`
    process.on('SIGTERM', () => { console.log('ZERO_AFTER_TERM'); process.exit(0); });
    console.log('READY'); setInterval(() => {}, 1_000);
  `, { timeout: deadline, onOutput: data => { output += data; } }), error => {
    assert.match(error.message, /timed out/);
    if (process.platform !== 'win32') assert.equal(error.exitCode, 0);
    return true;
  });
  assert(output.includes('READY'));
  if (process.platform !== 'win32') assert(output.includes('ZERO_AFTER_TERM'));
});

test('ignored graceful termination is escalated before a later zero exit', async () => {
  let output = '';
  const start = performance.now();
  await assert.rejects(execute(`
    process.on('SIGTERM', () => console.log('IGNORED_TERM'));
    console.log('READY'); setTimeout(() => { console.log('LATE_ZERO'); process.exit(0); }, 5_000);
  `, { timeout: deadline, onOutput: data => { output += data; } }), /timed out/);
  assert(output.includes('READY'));
  assert(!output.includes('LATE_ZERO'));
  assert(performance.now() - start < deadline + 3_000, 'Termination must be bounded');
  if (process.platform !== 'win32') assert(output.includes('IGNORED_TERM'));
});

test('cancellation is idempotent, rejects zero exit and detaches abort listeners', async () => {
  const controller = new AbortController();
  const result = execute(`
    process.on('SIGTERM', () => process.exit(0));
    console.log('READY'); setInterval(() => {}, 1_000);
  `, { signal: controller.signal, onOutput: data => {
    if (String(data).includes('READY')) { controller.abort(); controller.abort(); }
  } });
  await assert.rejects(result, /interrupted/);
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  await assert.rejects(execute("process.exit(0)", { signal: controller.signal }), /interrupted/);
});

test('spawn failure settles promptly instead of waiting for timeout', async () => {
  await assert.rejects(runOwnedCommand('missing-owned-e2e-executable', [], options), /failed/);
});

test('startup, build and browser failures each perform scoped cleanup and fail the outcome', async () => {
  for (const phase of ['startup', 'build', 'browser']) {
    const controller = new AbortController();
    const events = [];
    const outcome = await runWithCleanup(async () => {
      events.push(phase);
      await execute('process.exit(9)');
    }, async () => { events.push('owned-cleanup'); await execute('process.exit(0)'); }, controller.signal);
    assert.equal(outcome.failed, true);
    assert(outcome.error);
    assert.equal(outcome.cleanupError, undefined);
    assert.deepEqual(events, [phase, 'owned-cleanup']);
  }
});

test('cleanup failure and cancellation during final cleanup cannot produce PASS', async () => {
  const controller = new AbortController();
  const failedCleanup = await runWithCleanup(async () => {}, async () => { throw new Error('synthetic cleanup failure'); }, controller.signal);
  assert.equal(failedCleanup.failed, true);
  assert(failedCleanup.cleanupError);
  const interruptedCleanup = await runWithCleanup(async () => {}, async () => { controller.abort(); }, controller.signal);
  assert.equal(interruptedCleanup.failed, true);
});

test('falsy rejection payloads still fail work or cleanup', async () => {
  for (const rejection of [undefined, null, false, 0]) {
    const signal = new AbortController().signal;
    assert.equal((await runWithCleanup(() => Promise.reject(rejection), async () => {}, signal)).failed, true);
    assert.equal((await runWithCleanup(async () => {}, () => Promise.reject(rejection), signal)).failed, true);
  }
});

test('catchable interruption of the final browser command yields FAIL, exit 1 and cleanup', async () => {
  const helper = new URL('../../scripts/e2e-command.mjs', import.meta.url).href;
  let output = '';
  await assert.rejects(execute(`
    import { runOwnedCommand, runWithCleanup, watchInterruptions } from ${JSON.stringify(helper)};
    const controller = new AbortController();
    const unwatch = watchInterruptions(controller);
    setTimeout(() => {
      if (process.platform === 'win32') process.emit('SIGINT');
      else process.kill(process.pid, 'SIGINT');
    }, 300);
    const outcome = await runWithCleanup(async () => {
      await runOwnedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: process.cwd(), env: process.env, phase: 'browser-tests', signal: controller.signal,
        timeout: 5_000, grace: 100, hardWait: 2_000,
        onOutput: () => {},
      });
    }, async () => { console.log('OWNED_CLEANUP'); }, controller.signal);
    unwatch();
    console.log(outcome.failed ? 'FAIL' : 'PASS');
    process.exitCode = outcome.failed ? 1 : 0;
  `, { timeout: windows ? 8_000 : 4_000, onOutput: data => { output += data; } }), error => {
    assert.match(error.message, /failed/);
    assert.equal(error.exitCode, 1);
    return true;
  });
  assert(output.includes('OWNED_CLEANUP'));
  assert(output.includes('FAIL'));
  assert(!output.includes('PASS'));
});

test('POSIX termination kills owned stubborn descendants and leaves a sibling alone', { skip: process.platform === 'win32' ? 'POSIX process groups; Windows tree termination is exercised above' : false }, async () => {
  const controller = new AbortController();
    const sibling = execute("console.log('SIBLING'); setTimeout(() => console.log('STILL_ALIVE'), 1_200)", { signal: controller.signal });
  try {
    await assert.rejects(execute(`
      import { spawn } from 'node:child_process';
      process.on('SIGTERM', () => {});
      spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'inherit' });
      console.log('OWNED_TREE'); setInterval(() => {}, 1_000);
    `, { timeout: 600 }), /timed out/);
    assert((await sibling).includes('STILL_ALIVE'));
  } finally { controller.abort(); }
});

test('Windows job retains and terminates descendants after their direct parent exits', { skip: windows ? false : 'Windows Job Object regression' }, async () => {
  const output = await execute(`
    import { spawn } from 'node:child_process';
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log('DESCENDANT_PID=' + descendant.pid);
    process.exit(0);
  `);
  const pid = Number(output.match(/DESCENDANT_PID=(\d+)/)?.[1]);
  assert(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'Owned descendant must not survive');
});
