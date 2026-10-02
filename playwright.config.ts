import { defineConfig } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertAppEnvironment, assertOwnedDestinations, destinations } from './tests/e2e/safety.mjs';

if (!process.env.MADAF_E2E_RUN_ROOT) throw new Error('Use npm run test:e2e; never reuse an arbitrary app/backend');
const root = process.cwd();
const runRoot = process.env.MADAF_E2E_RUN_ROOT;
const marker = JSON.parse(readFileSync(resolve(runRoot, 'ownership.json'), 'utf8'));
const backend = JSON.parse(readFileSync(resolve(runRoot, 'backend.json'), 'utf8'));
assertOwnedDestinations(root, runRoot, marker, backend);
assertAppEnvironment(process.env, backend, readdirSync(root).filter(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'));
const proof = JSON.parse(readFileSync(resolve(runRoot, 'build-proof.json'), 'utf8'));
if (proof.projectId !== marker.projectId || proof.buildId !== readFileSync('.next/BUILD_ID', 'utf8').trim()) throw new Error('App build does not belong to this owned E2E run');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 45_000,
  globalTimeout: 360_000,
  expect: { timeout: 10_000 },
  outputDir: '.e2e/test-results',
  reporter: [['./tests/e2e/safe-reporter.ts']],
  use: { baseURL: destinations.app, browserName: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'off', video: 'off', acceptDownloads: true },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3108',
    url: `${destinations.app}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: 'ignore', stderr: 'ignore',
  },
});
