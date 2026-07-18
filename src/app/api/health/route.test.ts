/**
 * M8I.7 — /api/health application-liveness endpoint. Proves it returns a fixed,
 * bounded, never-cached JSON shape with ONLY safe fields (status, service, short
 * commit, coarse environment, timestamp), validates/truncates the commit SHA, is
 * synchronous (no DB / no secret access), and leaks no configuration.
 *
 * Runner: `npm run test:health-endpoint`.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET, HEAD } from "./route";

const KEYS = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_ENV"] as const;
const snapshot = () => KEYS.map((k) => [k, process.env[k]] as const);
function restore(snap: ReadonlyArray<readonly [string, string | undefined]>) {
  for (const [k, v] of snap) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
const snap = snapshot();
afterEach(() => restore(snap));

const EXPECTED_KEYS = ["status", "service", "commit", "environment", "timestamp"].sort();

test("GET returns 200 JSON, never cached, and is synchronous (no DB)", async () => {
  const res = GET();
  assert.ok(res instanceof Response, "GET returns a Response synchronously (no awaited DB)");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "madaf");
});

test("the payload has EXACTLY the five safe fields — nothing else", async () => {
  const body = await GET().json();
  assert.deepEqual(Object.keys(body).sort(), EXPECTED_KEYS, "no extra fields");
  assert.ok(["production", "preview", "development"].includes(body.environment));
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/, "timestamp is an ISO instant");
});

test("commit is validated and truncated to 7 lowercase hex chars", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "ABCDEF1234567890abcdef1234567890abcdef12"; // 40 mixed-case hex
  const body = await GET().json();
  assert.equal(body.commit, "abcdef1", "40-hex SHA → first 7, lowercased");
});

test("an invalid or absent commit SHA falls back to 'unknown'", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "not-a-real-sha";
  assert.equal((await GET().json()).commit, "unknown", "non-hex → unknown");
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  assert.equal((await GET().json()).commit, "unknown", "absent → unknown");
});

test("environment reflects VERCEL_ENV when it is a known label", async () => {
  process.env.VERCEL_ENV = "production";
  assert.equal((await GET().json()).environment, "production");
  process.env.VERCEL_ENV = "preview";
  assert.equal((await GET().json()).environment, "preview");
  process.env.VERCEL_ENV = "garbage-value";
  assert.ok(["production", "development"].includes((await GET().json()).environment),
    "an unknown VERCEL_ENV falls back to a coarse label, never echoed verbatim");
});

test("the response body leaks no configuration / secret / URL", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "deadbeef1234567890deadbeef1234567890dead";
  process.env.VERCEL_ENV = "production";
  const raw = await GET().text();
  assert.doesNotMatch(raw, /supabase|service_role|secret|token|https?:\/\/|SUPABASE|KEY/i,
    "no host, key, token, URL or project ref appears in the body");
});

test("HEAD returns 200 with no body and no-store", () => {
  const res = HEAD();
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});
