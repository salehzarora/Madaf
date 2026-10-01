import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { assertCleanEnvironment, assertOwnedDestinations, assertContainerOwnership, assertAppEnvironment, destinations } from '../tests/e2e/safety.mjs';
import { seedFixtures } from '../tests/e2e/seed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runRoot = resolve(root, '.e2e', randomBytes(6).toString('hex'));
const projectId = `madaf-browser-e2e-${runRoot.split(/[\\/]/).at(-1)}`;
const marker = { task: 'BROWSER-E2E-001', projectId, root, runRoot, app: destinations.app, auth: destinations.auth, storage: destinations.storage };
const started = performance.now();
const phases = {};
let stackCreated = false;
let interrupted = false;
let terminateCommand = () => {};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true; terminateCommand(); });

async function command(phase, file, args, env = process.env, timeout = 300_000) {
  if (interrupted && phase !== 'backend-cleanup') throw new Error('Browser E2E interrupted; cleaning up the owned stack');
  const start = performance.now();
  let output = '';
  let stdout = '';
  await mkdir(resolve(runRoot, 'private-logs'), { recursive: true });
  const child = spawn(file, args, { cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const terminate = () => {
    if (!child.pid) return;
    // Only this command's owned process tree; never kill a borrowed server.
    if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  };
  terminateCommand = terminate;
  const timer = setTimeout(terminate, timeout);
  try {
    await new Promise((done, fail) => {
      child.stdout.on('data', data => { output += data; stdout += data; });
      child.stderr.on('data', data => { output += data; });
      child.on('error', fail);
      child.on('exit', (code, signal) => code === 0 ? done() : fail(new Error(`${phase} failed (exit ${code}, signal ${signal ?? 'none'}); inspect ignored local private log`)));
    });
    return stdout;
  } finally {
    clearTimeout(timer);
    terminateCommand = () => {};
    phases[phase] = Math.round(performance.now() - start);
    await writeFile(resolve(runRoot, 'private-logs', `${phase}.log`), output, { mode: 0o600 });
  }
}

async function assertPortFree(port) {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  await new Promise(done => server.close(done));
}

let failed = false;
try {
  await mkdir(resolve(root, '.e2e'), { recursive: true });
  for (const file of ['browser-summary.json', 'run-summary.json']) await rm(resolve(root, '.e2e', file), { force: true });
  assertCleanEnvironment(process.env, (await readdir(root)).filter(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'));
  if (!process.env.npm_execpath) throw new Error('Run via npm run test:e2e so the same Node runtime launches npm');
  for (const port of [3108, 58320, 58321, 58322, 58324]) await assertPortFree(port);
  await mkdir(resolve(runRoot, 'supabase'), { recursive: true });
  await writeFile(resolve(runRoot, 'ownership.json'), JSON.stringify(marker), { mode: 0o600 });
  const config = (await readFile(resolve(root, 'tests/e2e/supabase.config.toml'), 'utf8')).replace('__PROJECT_ID__', projectId);
  await writeFile(resolve(runRoot, 'supabase/config.toml'), config);
  await cp(resolve(root, 'supabase/migrations'), resolve(runRoot, 'supabase/migrations'), { recursive: true });
  await command('docker-ready', 'docker', ['info', '--format', '{{.ServerVersion}}'], process.env, 30_000);
  stackCreated = true; // cleanup partial startup too, always scoped to this unique ID
  await command('backend-start', 'supabase', ['start', '--workdir', runRoot, '--exclude', 'studio,realtime,edge-runtime,analytics,vector,imgproxy,meta'], process.env);
  const status = JSON.parse(await command('backend-status', 'supabase', ['status', '--workdir', runRoot, '-o', 'json'], process.env, 30_000));
  assertOwnedDestinations(root, runRoot, marker, status);
  const labels = JSON.parse(await command('backend-owner', 'docker', ['inspect', `supabase_db_${projectId}`, '--format', '{{json .Config.Labels}}'], process.env, 30_000));
  assertContainerOwnership(marker, labels);
  await writeFile(resolve(runRoot, 'backend.json'), JSON.stringify(status), { mode: 0o600 });
  // Validate API/Auth/Storage before any fixture write, with redirect rejection.
  for (const [url, path] of [[destinations.auth, '/health'], [destinations.storage, '/status']]) {
    const response = await fetch(`${url}${path}`, { headers: { apikey: status.ANON_KEY }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Owned local Auth/Storage readiness failed');
  }
  const seedStart = performance.now();
  const fixtures = await seedFixtures(root, runRoot, marker, status);
  phases.fixtures = Math.round(performance.now() - seedStart);
  await writeFile(resolve(runRoot, 'fixtures.json'), JSON.stringify(fixtures), { mode: 0o600 });
  const env = {
    ...process.env,
    NEXT_PUBLIC_MADAF_DATA_MODE: 'supabase', NEXT_PUBLIC_SUPABASE_URL: destinations.api,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: destinations.app, MADAF_AUTH_PRIMARY_METHOD: 'email',
    MADAF_NATIVE_PUSH_ENABLED: 'false', MADAF_TRUSTED_DOCUMENT_STORAGE: 'disabled',
    MADAF_E2E_RUN_ROOT: runRoot, NEXT_TELEMETRY_DISABLED: '1',
  };
  assertAppEnvironment(env, status);
  // Do not set NODE_ENV=production before the existing local deployment gate.
  // npm run build retains the standard Turbopack + dynamic-route checks.
  await command('supabase-production-build', process.execPath, [process.env.npm_execpath, 'run', 'build'], env, 300_000);
  await writeFile(resolve(runRoot, 'build-proof.json'), JSON.stringify({ projectId, buildId: (await readFile(resolve(root, '.next/BUILD_ID'), 'utf8')).trim() }));
  await command('browser-tests', process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test'], env, 180_000);
  console.log('Chromium authenticated browser suite PASS (one worker, zero retries).');
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : 'Browser E2E setup/run failed');
} finally {
  if (stackCreated) {
    try {
      const savedMarker = JSON.parse(await readFile(resolve(runRoot, 'ownership.json'), 'utf8'));
      if (savedMarker.projectId !== projectId || savedMarker.runRoot !== runRoot) throw new Error('Cleanup ownership mismatch');
      await command('backend-cleanup', 'supabase', ['stop', '--workdir', runRoot, '--project-id', projectId, '--no-backup'], process.env, 60_000);
    } catch {
      failed = true;
      console.error('Owned backend cleanup failed; inspect the ignored run directory. No other services were stopped.');
    }
  }
  await mkdir(resolve(root, '.e2e'), { recursive: true });
  const summary = { task: 'BROWSER-E2E-001', result: failed ? 'FAIL' : 'PASS', duration_ms: Math.round(performance.now() - started), phase_duration_ms: phases };
  await writeFile(resolve(root, '.e2e/run-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ result: summary.result, duration_ms: summary.duration_ms, phase_duration_ms: phases }));
}
process.exitCode = failed ? 1 : 0;
