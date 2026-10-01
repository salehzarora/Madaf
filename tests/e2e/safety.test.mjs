import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertCleanEnvironment, assertOwnedDestinations, assertContainerOwnership, assertAppEnvironment, destinations } from './safety.mjs';

const root = resolve('owned-checkout');
const runRoot = resolve(root, '.e2e/run');
const marker = { task: 'BROWSER-E2E-001', projectId: 'madaf-browser-e2e-012345abcdef', root, runRoot, app: destinations.app, auth: destinations.auth, storage: destinations.storage };
const status = { API_URL: destinations.api, DB_URL: destinations.db, STORAGE_S3_URL: `${destinations.storage}/s3`, ANON_KEY: 'local-test-key'.repeat(4), SERVICE_ROLE_KEY: 'local-test-key'.repeat(4) };

test('accepts only a complete owned local destination set', () => assertOwnedDestinations(root, runRoot, marker, status));
test('rejects hosted API, remote DB, remote Storage and missing destinations before writes', () => {
  for (const [key, value] of [['API_URL', 'https://example.supabase.co'], ['DB_URL', 'postgresql://postgres:secret@remote.example/postgres'], ['STORAGE_S3_URL', 'https://example.supabase.co/storage/v1/s3'], ['API_URL', undefined]]) {
    assert.throws(() => assertOwnedDestinations(root, runRoot, marker, { ...status, [key]: value }));
  }
});
test('rejects the normal local stack even though it is loopback', () => {
  assert.throws(() => assertOwnedDestinations(root, runRoot, marker, { ...status, API_URL: 'http://127.0.0.1:55321' }));
});
test('rejects missing/foreign ownership markers and directories', () => {
  assert.throws(() => assertOwnedDestinations(root, root, marker, status));
  assert.throws(() => assertOwnedDestinations(root, runRoot, { ...marker, projectId: 'Madaf' }, status));
  assert.throws(() => assertOwnedDestinations(root, runRoot, { ...marker, root: resolve('another-checkout') }, status));
  assert.throws(() => assertContainerOwnership(marker, { 'com.supabase.cli.project': 'Madaf' }));
});
test('rejects inherited Production/Preview, keys, remote URLs and dotenv configuration', () => {
  for (const env of [{ VERCEL_ENV: 'preview' }, { SUPABASE_SERVICE_ROLE_KEY: 'secret' }, { NEXT_PUBLIC_SUPABASE_URL: destinations.api }, { DATABASE_URL: destinations.db }, { NODE_ENV: 'production' }, { FIREBASE_PRIVATE_KEY: 'secret' }, { NEXT_PUBLIC_MADAF_DATA_MODE: 'supabase' }]) {
    assert.throws(() => assertCleanEnvironment(env));
  }
  assert.throws(() => assertCleanEnvironment({}, ['.env.local']));
});
test('accepts CI mock mode as input but does not accept a borrowed server key', () => {
  assertCleanEnvironment({ CI: 'true', NEXT_PUBLIC_MADAF_DATA_MODE: 'mock', SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io' });
  assert.throws(() => assertCleanEnvironment({ SUPABASE_INTERNAL_IMAGE_REGISTRY: 'unapproved.example' }));
  assert.throws(() => assertOwnedDestinations(root, runRoot, marker, { ...status, SERVICE_ROLE_KEY: '' }));
});
test('direct browser launch rejects off-stack app configuration and borrowed keys', () => {
  const env = { NEXT_PUBLIC_MADAF_DATA_MODE: 'supabase', NEXT_PUBLIC_SUPABASE_URL: destinations.api, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: destinations.app, MADAF_AUTH_PRIMARY_METHOD: 'email', MADAF_NATIVE_PUSH_ENABLED: 'false', MADAF_TRUSTED_DOCUMENT_STORAGE: 'disabled' };
  assertAppEnvironment(env, status);
  for (const override of [{ NEXT_PUBLIC_SUPABASE_URL: 'https://remote.supabase.co' }, { SUPABASE_SERVICE_ROLE_KEY: 'borrowed' }, { NEXT_PUBLIC_MADAF_DATA_MODE: 'mock' }, { VERCEL_ENV: 'production' }, { MADAF_NATIVE_PUSH_ENABLED: 'true' }]) assert.throws(() => assertAppEnvironment({ ...env, ...override }, status));
});
