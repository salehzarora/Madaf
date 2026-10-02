import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { assertCleanEnvironment, assertOwnedDestinations, assertContainerOwnership, assertAppEnvironment, pinDockerDestination, assertDockerMetadataWarnings, parseDockerContextMetadata, destinations } from '../tests/e2e/safety.mjs';
import { runOwnedCommand, runWithCleanup, watchInterruptions } from './e2e-command.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runRoot = resolve(root, '.e2e', randomBytes(6).toString('hex'));
const projectId = `madaf-browser-e2e-${runRoot.split(/[\\/]/).at(-1)}`;
const marker = { task: 'BROWSER-E2E-001', projectId, root, runRoot, app: destinations.app, auth: destinations.auth, storage: destinations.storage };
const started = performance.now();
const phases = {};
let stackCreated = false;
let dockerEnv;
const interruption = new AbortController();
const unwatch = watchInterruptions(interruption);

async function command(phase, file, args, env = process.env, timeout = 300_000, metadataOnly = false) {
  const start = performance.now();
  let output = '';
  let stdout = '';
  let stderr = '';
  await mkdir(resolve(runRoot, 'private-logs'), { recursive: true });
  try {
    stdout = await runOwnedCommand(file, args, { cwd: root, env, phase, timeout,
      signal: phase === 'backend-cleanup' ? undefined : interruption.signal,
      onOutput: (data, stream) => { output += data; if (stream === 'stderr') stderr += data; },
    });
    // Docker can warn and silently fall back when its config is unreadable or
    // malformed. Metadata resolution must fail closed on any such warning.
    if (metadataOnly) assertDockerMetadataWarnings(stderr);
    return stdout;
  } finally {
    phases[phase] = Math.round(performance.now() - start);
    await writeFile(resolve(runRoot, 'private-logs', `${phase}.log`), output, { mode: 0o600 });
  }
}

async function assertPortFree(port) {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  await new Promise(done => server.close(done));
}

const outcome = await runWithCleanup(async () => {
  await mkdir(resolve(root, '.e2e'), { recursive: true });
  for (const file of ['browser-summary.json', 'run-summary.json']) await rm(resolve(root, '.e2e', file), { force: true });
  assertCleanEnvironment(process.env, (await readdir(root)).filter(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'));
  if (!process.env.npm_execpath) throw new Error('Run via npm run test:e2e so the same Node runtime launches npm');
  const contextName = (await command('docker-context-name', 'docker', ['context', 'show'], process.env, 10_000, true)).trim();
  if (!contextName) throw new Error('Docker context is unresolved');
  const context = parseDockerContextMetadata(await command('docker-context-metadata', 'docker', ['context', 'inspect', contextName, '--format', '{{json .}}'], process.env, 10_000, true), contextName);
  const docker = pinDockerDestination(process.env, context);
  dockerEnv = docker.env;
  marker.dockerEndpoint = docker.endpoint;
  for (const port of [3108, 58320, 58321, 58322, 58324]) await assertPortFree(port);
  await mkdir(resolve(runRoot, 'supabase'), { recursive: true });
  await writeFile(resolve(runRoot, 'ownership.json'), JSON.stringify(marker), { mode: 0o600 });
  const config = (await readFile(resolve(root, 'tests/e2e/supabase.config.toml'), 'utf8')).replace('__PROJECT_ID__', projectId);
  await writeFile(resolve(runRoot, 'supabase/config.toml'), config);
  await cp(resolve(root, 'supabase/migrations'), resolve(runRoot, 'supabase/migrations'), { recursive: true });
  await command('docker-ready', 'docker', ['info', '--format', '{{.ServerVersion}}'], dockerEnv, 30_000);
  stackCreated = true; // cleanup partial startup too, always scoped to this unique ID
  await command('backend-start', 'supabase', ['start', '--workdir', runRoot, '--exclude', 'studio,realtime,edge-runtime,analytics,vector,imgproxy,meta'], dockerEnv);
  const status = JSON.parse(await command('backend-status', 'supabase', ['status', '--workdir', runRoot, '-o', 'json'], dockerEnv, 30_000));
  assertOwnedDestinations(root, runRoot, marker, status);
  const labels = JSON.parse(await command('backend-owner', 'docker', ['inspect', `supabase_db_${projectId}`, '--format', '{{json .Config.Labels}}'], dockerEnv, 30_000));
  assertContainerOwnership(marker, labels);
  await writeFile(resolve(runRoot, 'backend.json'), JSON.stringify(status), { mode: 0o600 });
  // Validate API/Auth/Storage before any fixture write, with redirect rejection.
  for (const [url, path] of [[destinations.auth, '/health'], [destinations.storage, '/status']]) {
    const response = await fetch(`${url}${path}`, { headers: { apikey: status.ANON_KEY }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Owned local Auth/Storage readiness failed');
  }
  await command('fixtures', process.execPath, [resolve(root, 'tests/e2e/seed.mjs'), runRoot], dockerEnv, 60_000);
  await command('pricing-authenticated-tests', process.execPath, [resolve(root, 'tests/e2e/pricing.live.mjs'), runRoot], dockerEnv, 90_000);
  await command('pricing-lock-tests', process.execPath, [resolve(root, 'tests/e2e/pricing-concurrency.live.mjs'), runRoot], dockerEnv, 90_000);
  const env = {
    ...dockerEnv,
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
  await command('browser-tests', process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test'], env, 360_000);
}, async () => {
  if (stackCreated) {
    const savedMarker = JSON.parse(await readFile(resolve(runRoot, 'ownership.json'), 'utf8'));
    if (savedMarker.projectId !== projectId || savedMarker.runRoot !== runRoot || savedMarker.dockerEndpoint !== dockerEnv.DOCKER_HOST) throw new Error('Cleanup ownership mismatch');
    await command('backend-cleanup', 'supabase', ['stop', '--workdir', runRoot, '--project-id', projectId, '--no-backup'], dockerEnv, 60_000);
  }
}, interruption.signal);
try {
  if (outcome.error) console.error(outcome.error instanceof Error ? outcome.error.message : 'Browser E2E setup/run failed');
  if (outcome.cleanupError) console.error('Owned backend cleanup failed; inspect the ignored run directory. No other services were stopped.');
  await mkdir(resolve(root, '.e2e'), { recursive: true });
  const summary = { task: 'BROWSER-E2E-001', result: outcome.failed || interruption.signal.aborted ? 'FAIL' : 'PASS', duration_ms: Math.round(performance.now() - started), phase_duration_ms: phases };
  await writeFile(resolve(root, '.e2e/run-summary.json'), JSON.stringify(summary, null, 2));
  if (interruption.signal.aborted && summary.result === 'PASS') {
    summary.result = 'FAIL';
    await writeFile(resolve(root, '.e2e/run-summary.json'), JSON.stringify(summary, null, 2));
  }
  if (summary.result === 'PASS') console.log('Chromium authenticated browser suite PASS (one worker, zero retries).');
  console.log(JSON.stringify({ result: summary.result, duration_ms: summary.duration_ms, phase_duration_ms: phases }));
  process.exitCode = summary.result === 'FAIL' ? 1 : 0;
} finally { unwatch(); }
