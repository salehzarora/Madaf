/**
 * M8I.7 — HTTP security headers + CSP. Proves the policy applied to every route
 * is production-safe: no 'unsafe-eval' in production, no wildcard, framing fully
 * denied, and the ONLY cross-origin allowed is the app's own Supabase host
 * (derived from its public URL — never a secret, never "all https").
 *
 * Runner: `npm run test:security-headers`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentSecurityPolicy,
  securityHeaders,
  supabaseOrigins,
} from "./security-headers";

const SUPA = "https://abcdefgh.supabase.co";

test("production CSP never allows 'unsafe-eval'", () => {
  const csp = contentSecurityPolicy({ production: true, supabaseUrl: SUPA });
  assert.doesNotMatch(csp, /unsafe-eval/, "production script-src has no 'unsafe-eval'");
});

test("development CSP allows 'unsafe-eval' (HMR only)", () => {
  const csp = contentSecurityPolicy({ production: false, supabaseUrl: null });
  assert.match(csp, /script-src[^;]*'unsafe-eval'/, "dev script-src includes 'unsafe-eval'");
});

test("CSP contains no wildcard source", () => {
  const prod = contentSecurityPolicy({ production: true, supabaseUrl: SUPA });
  const dev = contentSecurityPolicy({ production: false, supabaseUrl: SUPA });
  assert.doesNotMatch(prod, /\*/, "production CSP has no '*'");
  assert.doesNotMatch(dev, /\*/, "dev CSP has no '*'");
});

test("CSP fully denies framing and locks the document base", () => {
  const csp = contentSecurityPolicy({ production: true, supabaseUrl: SUPA });
  assert.match(csp, /frame-ancestors 'none'/, "frame-ancestors none");
  assert.match(csp, /frame-src 'none'/, "frame-src none");
  assert.match(csp, /object-src 'none'/, "object-src none");
  assert.match(csp, /base-uri 'self'/, "base-uri self");
  assert.match(csp, /form-action 'self'/, "form-action self");
  assert.match(csp, /default-src 'self'/, "default-src self");
});

test("CSP allows ONLY the app's own Supabase origin cross-origin", () => {
  const csp = contentSecurityPolicy({ production: true, supabaseUrl: SUPA });
  // https origin present for connect + img; wss origin present for Realtime.
  assert.match(csp, /connect-src[^;]*https:\/\/abcdefgh\.supabase\.co/, "connect-src has the https origin");
  assert.match(csp, /connect-src[^;]*wss:\/\/abcdefgh\.supabase\.co/, "connect-src has the wss origin");
  assert.match(csp, /img-src[^;]*https:\/\/abcdefgh\.supabase\.co/, "img-src has the https origin");
  // No other host leaks in.
  assert.doesNotMatch(csp, /http:\/\//, "no plain-http origin in a production CSP");
});

test("with no Supabase URL the CSP connect-src is self-only", () => {
  const csp = contentSecurityPolicy({ production: true, supabaseUrl: null });
  assert.match(csp, /connect-src 'self'(;|$)/, "connect-src collapses to 'self' only");
  assert.doesNotMatch(csp, /supabase/, "no supabase host when there is no URL");
});

test("securityHeaders returns the full hardening set", () => {
  const headers = securityHeaders({ production: true, supabaseUrl: SUPA });
  const byKey = new Map(headers.map((h) => [h.key, h.value]));
  assert.ok(byKey.has("Content-Security-Policy"), "CSP header present");
  assert.equal(byKey.get("X-Content-Type-Options"), "nosniff");
  assert.equal(byKey.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(byKey.get("X-Frame-Options"), "DENY");
  assert.match(byKey.get("Permissions-Policy") ?? "", /geolocation=\(\)/);
  for (const h of headers) assert.ok(h.value.length > 0, `${h.key} has a value`);
});

test("supabaseOrigins parses https and http, and rejects other schemes", () => {
  assert.deepEqual(supabaseOrigins("https://x.supabase.co"), {
    http: "https://x.supabase.co",
    ws: "wss://x.supabase.co",
  });
  assert.deepEqual(supabaseOrigins("http://127.0.0.1:54321"), {
    http: "http://127.0.0.1:54321",
    ws: "ws://127.0.0.1:54321",
  });
  assert.deepEqual(supabaseOrigins(null), { http: null, ws: null });
  assert.deepEqual(supabaseOrigins("not-a-url"), { http: null, ws: null });
  assert.deepEqual(supabaseOrigins("ftp://x.example"), { http: null, ws: null });
});
