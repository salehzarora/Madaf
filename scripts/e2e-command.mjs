import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each POSIX child owns a new process group. Windows has no Node-compatible
// graceful tree signal. Its wrapper owns a Job Object before creating children;
// killing the wrapper closes that job even if an intermediate parent has exited.
export function runOwnedCommand(file, args, {
  cwd, env, phase, signal, timeout = 300_000, grace = 2_000,
  hardWait = 5_000, onOutput = () => {},
}) {
  return new Promise((resolve, reject) => {
    let child;
    let stdout = '';
    let termination;
    let settled = false;
    let deadline;
    let escalation;
    let terminationDeadline;
    const failure = (exitCode, signalName) => Object.assign(
      new Error(`${phase} ${termination ?? 'failed'}; inspect ignored local private log`),
      { exitCode, signal: signalName },
    );
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      clearTimeout(terminationDeadline);
      signal?.removeEventListener('abort', interrupt);
      child?.removeListener('error', spawnError);
      child?.removeListener('close', closed);
      child?.stdout.removeAllListeners('data');
      child?.stderr.removeAllListeners('data');
      if (error) reject(error);
      else resolve(stdout);
    };
    const killGroup = sig => {
      try { process.kill(-child.pid, sig); }
      catch (error) {
        // An already-exited process group is an ordinary termination race.
        if (error.code !== 'ESRCH') termination = `${termination}; tree termination failed`;
      }
    };
    const terminate = reason => {
      if (settled || termination) return;
      termination = reason; // Latch failure BEFORE signalling, regardless of exit code.
      if (process.platform === 'win32') {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'],
            { windowsHide: true, timeout: hardWait }, () => {});
        }
      } else {
        killGroup('SIGTERM');
        escalation = setTimeout(() => killGroup('SIGKILL'), grace);
      }
      terminationDeadline = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(failure());
      }, (process.platform === 'win32' ? 0 : grace) + hardWait);
    };
    const interrupt = () => terminate('interrupted');
    const spawnError = () => finish(failure());
    const closed = (code, signalName) => {
      // Remove any stubborn descendants after the parent closes its pipes.
      if (termination && process.platform !== 'win32') killGroup('SIGKILL');
      finish(termination || code !== 0 ? failure(code, signalName) : undefined);
    };
    if (signal?.aborted) {
      termination = 'interrupted';
      finish(failure());
      return;
    }
    let executable = file;
    let argumentsList = args;
    let childEnv = env;
    if (process.platform === 'win32') {
      executable = 'powershell.exe';
      argumentsList = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./e2e-command-windows.ps1', import.meta.url))];
      childEnv = { ...env, MADAF_E2E_OWNED_COMMAND: Buffer.from(JSON.stringify({ file, args, cwd,
        node: process.execPath, proxy: fileURLToPath(new URL('./e2e-command-windows-child.mjs', import.meta.url)),
      })).toString('base64') };
    }
    child = spawn(executable, argumentsList, { cwd, env: childEnv, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { stdout += data; onOutput(data, 'stdout'); });
    child.stderr.on('data', data => onOutput(data, 'stderr'));
    child.once('error', spawnError);
    child.once('close', closed);
    signal?.addEventListener('abort', interrupt, { once: true });
    deadline = setTimeout(() => terminate('timed out'), timeout);
    // Covers an abort between the initial check and listener registration.
    if (signal?.aborted) interrupt();
  });
}

export function watchInterruptions(controller) {
  const interrupt = () => controller.abort();
  for (const name of ['SIGINT', 'SIGTERM']) process.on(name, interrupt);
  return () => {
    for (const name of ['SIGINT', 'SIGTERM']) process.removeListener(name, interrupt);
  };
}

// Cleanup uses its own command deadline, not the cancelled work signal.
// A last-command cancellation (or a cleanup failure) cannot produce PASS.
export async function runWithCleanup(work, cleanup, signal) {
  let failed = false;
  let error;
  let cleanupError;
  try {
    signal.throwIfAborted();
    await work();
    signal.throwIfAborted();
  } catch (caught) { failed = true; error = caught; }
  finally {
    try { await cleanup(); }
    catch (caught) { failed = true; cleanupError = caught; }
  }
  return { failed: failed || signal.aborted, error, cleanupError };
}
