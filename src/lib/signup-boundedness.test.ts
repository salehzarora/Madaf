/**
 * SIGNUP-BOUNDEDNESS-FOLLOWUP — source guards proving the three capped
 * signup-request reads are gone, replaced by bounded/exact/targeted ones:
 *   S1 the Customers page pending-signup badge uses the EXACT count, not a
 *      capped row-list + JS filter;
 *   S2 the approval duplicate-guard resolves its target via a TARGETED, PII-lean
 *      single-request read (not a capped `listSignupRequests().find`), and the
 *      authoritative approve RPC path is untouched;
 *   S3 the signup management page renders a BOUNDED, page-numbered requests list
 *      (count-first → clamp → `.range`, `created_at DESC`/`id DESC`), never the
 *      capped full list.
 *
 * These are static source guards. The behavioural proof over live PostgREST
 * (>1000 rows, skip-/dup-free traversal, targeted read beyond the max_rows
 * window, RLS) is in src/lib/data/signup-requests.live.test.ts.
 *
 * Runner: `npm run test:signup-boundedness` (also part of `test:core`).
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

/** The body of a top-level function, sliced at the first column-0 `}` (nested
 * `}` are indented, so the delimiter lands on the function's own closing brace). */
const bodyOf = (src: string, decl: string): string => {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, `not found: ${decl}`);
  const fn = src.slice(start);
  const end = fn.indexOf("\n}\n");
  assert.ok(end > 0, `no function end for: ${decl}`);
  return fn.slice(0, end);
};

// ── S1 — Customers page pending-signup badge ───────────────────────────────
test("S1 guard: Customers page badge uses the exact count, not a capped signup row-list", () => {
  const page = read("app/[locale]/admin/customers/page.tsx");
  assert.match(page, /countPendingSignupRequests\(\)/, "uses the exact count helper");
  // \blistSignupRequests\b does NOT match inside listSignupRequestsPage (no word
  // boundary before "Page"), so this asserts the CAPPED full-list read is gone.
  assert.doesNotMatch(page, /\blistSignupRequests\b/, "no capped signup row-list read");
  assert.doesNotMatch(
    page,
    /\.filter\(\(r\) => r\.status === "pending"\)/,
    "no JS pending filter over loaded rows",
  );
});

// ── S2 — Approval targeted single-request read ─────────────────────────────
test("S2 guard: approval resolves its target via the targeted read, not a capped list", () => {
  const action = read("lib/actions/customer-signup.ts");
  assert.match(
    action,
    /getSignupRequestForApproval\(input\.requestId\)/,
    "targeted single-request read",
  );
  assert.doesNotMatch(action, /\blistSignupRequests\b/, "no capped list-then-find");
  // The authoritative atomic mutation (approve RPC) is unchanged.
  assert.match(
    action,
    /approveSignupRequest\(input\.requestId\)/,
    "approve RPC path preserved",
  );
  // The duplicate guard still consumes name + phone only.
  assert.match(action, /name: request\.name/, "duplicate check keeps name");
  assert.match(action, /phone: request\.phone/, "duplicate check keeps phone");
});

test("S2 guard: the targeted read is by-id, tenant-scoped, single-row and PII-lean", () => {
  const data = read("lib/data/customer-signup.ts");
  const body = bodyOf(data, "export async function sbGetSignupRequestForApproval");
  assert.match(
    body,
    /if \(!UUID_RE\.test\(requestId\)\) return undefined;/,
    "non-UUID short-circuits before querying (no uuid-cast error; defers to RPC)",
  );
  assert.match(body, /\.select\("id, name, phone"\)/, "projects only id/name/phone");
  assert.doesNotMatch(body, /email|notes|address|city_/, "no extra PII columns loaded");
  assert.match(body, /\.eq\("tenant_id", tenantId\)/, "tenant-scoped (server-derived)");
  assert.match(body, /\.eq\("id", requestId\)/, "resolves by the request id");
  assert.match(body, /\.maybeSingle\(\)/, "single row (missing ⇒ undefined, defers to RPC)");
});

// ── S3 — Bounded, page-numbered management list ────────────────────────────
test("S3 guard: signup management page uses the bounded page reader, not the capped list", () => {
  const page = read("app/[locale]/admin/customers/signup/page.tsx");
  assert.match(page, /listSignupRequestsPage\(/, "uses the bounded page reader");
  assert.doesNotMatch(page, /\blistSignupRequests\b/, "no capped full-list read");
  // A repeated ?page arrives as string[]; the parser must collapse it BEFORE any
  // string method, or a crafted `?page=1&page=2` throws during render.
  assert.match(page, /page\?: string \| string\[\]/, "searchParams typed for the array form");
  assert.match(page, /Array\.isArray\(rawPage\)/, "repeated ?page (string[]) collapsed before parsing");
});

test("S3 guard: the bounded page reader is count-first, clamped, ranged and deterministically ordered", () => {
  const data = read("lib/data/customer-signup.ts");
  const body = bodyOf(data, "export async function sbListSignupRequestsPage");
  assert.match(body, /count: "exact", head: true/, "exact total via head count (max_rows-safe)");
  assert.match(body, /\.range\(offset, offset \+ size - 1\)/, "bounded .range page window");
  assert.match(
    body,
    /\.order\("created_at", \{ ascending: false \}\)/,
    "newest-first ordering",
  );
  assert.match(
    body,
    /\.order\("id", \{ ascending: false \}\)/,
    "unique-id tie-break (offset paging stays skip-/dup-free)",
  );
  assert.match(body, /\.eq\("tenant_id", tenantId\)/, "tenant-scoped (server-derived)");
  assert.match(
    body,
    /Math\.min\(Math\.max\(1, requested\), totalPages\)/,
    "out-of-range page clamps to the last page (no PostgREST 416)",
  );
  // The page window can never be unbounded — pageSize is hard-capped.
  assert.match(body, /SIGNUP_REQUESTS_MAX_PAGE_SIZE/, "pageSize hard-capped");
});

test("S3 guard: the bounded page + targeted reads are server-tenant-driven wrappers", () => {
  const data = read("lib/data/customer-signup.ts");
  assert.match(
    data,
    /const \{ client, tenantId \} = await getDataContext\(\);\s*return sbListSignupRequestsPage\(client, tenantId, page, pageSize\);/,
    "listSignupRequestsPage supplies the server-derived tenant (client never chooses it)",
  );
  assert.match(
    data,
    /const \{ client, tenantId \} = await getDataContext\(\);\s*return sbGetSignupRequestForApproval\(client, tenantId, requestId\);/,
    "getSignupRequestForApproval supplies the server-derived tenant (client never chooses it)",
  );
});

test("S3 guard: the manager renders bounded pagination controls (URL ?page is the source of truth)", () => {
  const mgr = read("components/admin/signup-manager.tsx");
  assert.match(mgr, /requestsTotalPages > 1/, "controls render only when paginated");
  assert.match(mgr, /goToRequestsPage\(requestsPage - 1\)/, "previous-page control");
  assert.match(mgr, /goToRequestsPage\(requestsPage \+ 1\)/, "next-page control");
  assert.match(
    mgr,
    /router\.push\(`\/\$\{locale\}\/admin\/customers\/signup\?page=\$\{next\}`\)/,
    "navigates by URL ?page (server re-fetches + clamps)",
  );
  assert.match(mgr, /interpolate\(t\.pageLabel/, "localized page label");
});
