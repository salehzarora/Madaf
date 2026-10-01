import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertCleanEnvironment, assertOwnedDestinations, assertContainerOwnership, assertAppEnvironment, assertDockerOverrides, pinDockerDestination, assertDockerMetadataWarnings, parseDockerContextMetadata, destinations } from './safety.mjs';

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

const context = (Host, Name = 'default') => ({ Name, Endpoints: { docker: { Host, SkipTLSVerify: false } }, TLSMaterial: {} });
test('offline Docker guard accepts local Unix default, Desktop and rootless sockets', () => {
  for (const host of ['unix:///var/run/docker.sock', 'unix:///home/local/.docker/run/docker.sock', 'unix:///run/user/1000/docker.sock']) {
    const pinned = pinDockerDestination({}, context(host), 'linux');
    assert.equal(pinned.endpoint, host);
    assert.equal(pinned.env.DOCKER_HOST, host);
    assert(!Object.hasOwn(pinned.env, 'DOCKER_CONTEXT'));
    assert.equal(pinDockerDestination({ DOCKER_HOST: host }, context(host), 'linux').endpoint, host);
  }
});
test('offline Docker guard supports Windows local default and Docker Desktop pipes', () => {
  for (const host of ['npipe:////./pipe/docker_engine', 'npipe:////./pipe/dockerDesktopLinuxEngine']) {
    assert.equal(pinDockerDestination({}, context(host), 'win32').endpoint, host);
  }
  const original = { DOCKER_CONTEXT: 'desktop-linux', DOCKER_CONFIG: '/local/docker-config', CI: 'true' };
  const pinned = pinDockerDestination(original, context('npipe:////./pipe/dockerDesktopLinuxEngine', 'desktop-linux'), 'win32');
  assert.equal(original.DOCKER_CONTEXT, 'desktop-linux', 'Never change the owner environment/context');
  assert.equal(pinned.env.DOCKER_CONFIG, original.DOCKER_CONFIG);
  assert(!Object.hasOwn(pinned.env, 'DOCKER_CONTEXT'));
});
test('offline Docker guard rejects remote hosts and remote configured contexts without probing', () => {
  for (const host of ['tcp://remote.example:2375', 'tcp://127.0.0.1:2375', 'ssh://remote.example', 'https://remote.example', 'fd://3', 'unix://remote.example/run/docker.sock', 'unix://relative.sock', 'npipe:////remote.example/pipe/docker_engine']) {
    assert.throws(() => assertDockerOverrides({ DOCKER_HOST: host }));
    for (const platform of ['linux', 'win32']) assert.throws(() => pinDockerDestination({ DOCKER_CONTEXT: 'remote' }, context(host, 'remote'), platform));
  }
});
test('offline Docker guard rejects conflicting selectors, TLS overrides and unresolved metadata', () => {
  const local = 'unix:///var/run/docker.sock';
  for (const env of [
    { DOCKER_HOST: local, DOCKER_CONTEXT: 'other' },
    { DOCKER_TLS: '1' }, { DOCKER_TLS_VERIFY: '0' }, { DOCKER_CERT_PATH: '/certs' },
  ]) {
    assert.throws(() => assertDockerOverrides(env));
    assert.throws(() => pinDockerDestination(env, context(local), 'linux'));
  }
  for (const metadata of [undefined, {}, { Name: 'default' }, { ...context(local), TLSMaterial: { docker: ['cert.pem'] } }, { ...context(local), Endpoints: { docker: { Host: local, SkipTLSVerify: true } } }]) {
    assert.throws(() => pinDockerDestination({}, metadata, 'linux'));
  }
  assert.throws(() => pinDockerDestination({ DOCKER_CONTEXT: 'missing' }, context(local), 'linux'));
  assert.throws(() => pinDockerDestination({ DOCKER_HOST: local }, context('unix:///another/socket'), 'linux'));
  assert.throws(() => pinDockerDestination({ DOCKER_HOST: local }, context(local, 'desktop-linux'), 'linux'));
});
test('Docker metadata warnings, malformed config output and selection changes fail closed', () => {
  assertDockerMetadataWarnings('');
  assert.throws(() => assertDockerMetadataWarnings('WARNING: malformed config file /private/path'), error => {
    assert(!error.message.includes('/private/path'));
    return true;
  });
  assert.throws(() => parseDockerContextMetadata('private malformed diagnostic', 'default'), error => {
    assert(!error.message.includes('private malformed diagnostic'));
    return true;
  });
  assert.throws(() => parseDockerContextMetadata(JSON.stringify(context('unix:///var/run/docker.sock')), 'changed-context'));
});
