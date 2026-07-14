/**
 * PILOT-READINESS-BATCH-C · P2 correction — source guards proving the Dashboard
 * pending-signup card no longer loads (and JS-filters) signup rows, and the
 * count query is a bounded, PII-free, exact-count read. The behavioural proof
 * over live PostgREST is in src/lib/data/signup-count.live.test.ts.
 *
 * Runner: `npm run test:signup-count`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
// Normalize CRLF → LF so the `\n}\n` function-end delimiter matches on Windows
// checkouts (a `\r\n}\r\n` file would otherwise slice to EOF).
const read = (rel: string): string =>
  stripComments(
    readFileSync(join(process.cwd(), "src", rel), "utf8").replace(/\r\n/g, "\n"),
  );

test("guard: the Dashboard card uses the exact count, not a signup row-list", () => {
  const page = read("app/[locale]/admin/page.tsx");
  assert.match(page, /countPendingSignupRequests\(\)/, "uses the exact count helper");
  // No signup ROW list is read merely to compute the pending count.
  assert.doesNotMatch(page, /\blistSignupRequests\b/, "no signup row-list read");
  assert.doesNotMatch(
    page,
    /\.filter\(\(r\) => r\.status === "pending"\)/,
    "no JS pending filter over loaded rows",
  );
});

test("guard: the count query is exact, head-only (no rows/PII) and pending-scoped", () => {
  const src = read("lib/data/customer-signup.ts");
  const fn = src.slice(src.indexOf("export async function sbCountPendingSignupRequests"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /count: "exact", head: true/, "exact count, no row body (no PII)");
  assert.match(body, /\.eq\("tenant_id", tenantId\)/, "tenant-scoped (server-derived)");
  // Pending = neither approved nor rejected (there is no status column).
  assert.match(body, /\.is\("approved_at", null\)/, "excludes approved");
  assert.match(body, /\.is\("rejected_at", null\)/, "excludes rejected");
  // Selects only the id (never name/phone/email/notes/address).
  assert.match(body, /\.select\("id",/, "selects only id, never signup PII columns");
  assert.doesNotMatch(body, /name|phone|email|notes|address/, "no PII column referenced");
  // Fails (throws) on a read error — never a silent 0.
  assert.match(body, /throw new Error/, "read failure throws (page error contract), not a silent 0");
});

test("guard: the exact count is server-tenant-driven and RLS-authoritative", () => {
  const src = read("lib/data/customer-signup.ts");
  // The app-facing entry supplies the tenant from the server context; the client
  // never chooses it.
  assert.match(
    src,
    /const \{ client, tenantId \} = await getDataContext\(\);\s*return sbCountPendingSignupRequests\(client, tenantId\);/,
    "tenant is server-derived via getDataContext (not client-chosen)",
  );
});
