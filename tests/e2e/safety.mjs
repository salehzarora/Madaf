import assert from 'node:assert/strict';
import { resolve, relative, isAbsolute } from 'node:path';

export const destinations = Object.freeze({
  app: 'http://127.0.0.1:3108',
  api: 'http://127.0.0.1:58321',
  auth: 'http://127.0.0.1:58321/auth/v1',
  storage: 'http://127.0.0.1:58321/storage/v1',
  db: 'postgresql://postgres:postgres@127.0.0.1:58322/postgres',
});

export function assertCleanEnvironment(env, envFiles = []) {
  // Fail before creating services or writing fixtures. Do not silently discard
  // an inherited hosted configuration and pretend it was safe to use.
  const forbidden = /^(VERCEL(?:_|$)|FIREBASE_|SUPABASE_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE)$|NEXT_PUBLIC_SUPABASE_|NEXT_PUBLIC_(?:APP|SITE)_URL$|MADAF_(?:TRUSTED_DOCUMENT|EMAIL|AUTH|DEV_PHONE|NATIVE_PUSH)|RESEND_|TWILIO_)/;
  for (const key of Object.keys(env)) {
    // setup-cli@v1 sets this image registry; it is not a backend destination.
    if (key === 'SUPABASE_INTERNAL_IMAGE_REGISTRY' && env[key] === 'ghcr.io') continue;
    assert(!forbidden.test(key), `Inherited configuration is forbidden: ${key}`);
  }
  assert.notEqual(env.NODE_ENV, 'production', 'Do not inherit a production process');
  assert(!env.NEXT_PUBLIC_MADAF_DATA_MODE || env.NEXT_PUBLIC_MADAF_DATA_MODE === 'mock', 'Inherited backend mode is forbidden');
  assert.deepEqual(envFiles, [], 'Local dotenv files are forbidden in the E2E checkout');
}

export function assertOwnedDestinations(root, runRoot, marker, status) {
  const path = relative(resolve(root, '.e2e'), resolve(runRoot));
  assert(path && !path.startsWith('..') && !isAbsolute(path), 'Run must live inside the owned .e2e directory');
  assert.equal(marker.task, 'BROWSER-E2E-001');
  assert.equal(marker.root, resolve(root));
  assert.equal(marker.runRoot, resolve(runRoot));
  assert.match(marker.projectId, /^madaf-browser-e2e-[a-f0-9]{12}$/);
  assert.equal(marker.app, destinations.app);
  assert.equal(marker.auth, destinations.auth);
  assert.equal(marker.storage, destinations.storage);
  // Boolean assertions never echo a rejected URL containing credentials.
  assert(status.API_URL === destinations.api, 'Auth/API must be the owned loopback stack');
  assert(status.DB_URL === destinations.db, 'DB must be the owned loopback stack');
  assert(status.STORAGE_S3_URL === `${destinations.storage}/s3`, 'Storage must be the owned loopback stack');
  assert(typeof status.ANON_KEY === 'string' && status.ANON_KEY.length > 20, 'Local anon key is missing');
  assert(typeof status.SERVICE_ROLE_KEY === 'string' && status.SERVICE_ROLE_KEY.length > 20, 'Local server key is missing');
}

export function assertContainerOwnership(marker, labels) {
  assert.equal(labels['com.supabase.cli.project'], marker.projectId, 'Container belongs to another stack');
}

export function assertAppEnvironment(env, status, envFiles = []) {
  const expected = {
    NEXT_PUBLIC_MADAF_DATA_MODE: 'supabase', NEXT_PUBLIC_SUPABASE_URL: destinations.api,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: destinations.app, MADAF_AUTH_PRIMARY_METHOD: 'email',
    MADAF_NATIVE_PUSH_ENABLED: 'false', MADAF_TRUSTED_DOCUMENT_STORAGE: 'disabled',
  };
  const other = { ...env };
  for (const [name, value] of Object.entries(expected)) {
    // Assertion text contains only the field name, never compared key values.
    assert(env[name] === value, `Application environment differs from owned stack: ${name}`);
    delete other[name];
  }
  assertCleanEnvironment(other, envFiles);
}
