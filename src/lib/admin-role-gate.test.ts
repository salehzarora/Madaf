/**
 * PILOT-READINESS-BATCH-B · B1 — route-level role gate on the catalog/customer
 * create + edit forms.
 *
 * The admin layout only requires a session + tenant membership; it does NOT
 * check the role. The Products/Customers LIST pages hide the "add"/"edit" CTAs
 * from a sales_rep, but hiding a link does not stop direct navigation — a
 * sales_rep who typed `/admin/products/new` got a fully editable form (the write
 * RPC would ultimately reject the save, but the form should never render). These
 * guards assert each of the four routes now denies a sales_rep at the route
 * level with `notFound()`, using the ACTIVE-tenant role, while keeping mock mode
 * open (create) / already-404'd (edit) as before.
 *
 * These are SOURCE guards (the repo's convention for route-level authorization —
 * a Next server-component page cannot be rendered in node:test). The REAL
 * authority — that the write RPCs reject a sales_rep regardless of the UI — is
 * proven at the DB layer in supabase/tests/product_write_rpcs.test.sql and the
 * existing customer_audit / customer_origin pgTAP suites.
 *
 * Runner: `npm run test:admin-role-gate`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
/** Strip block + line comments so a guard scans CODE, not the doc-comments that
 * describe the very invariants under test. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The explicit owner/admin allowlist denial each route must contain. */
const DENIES_NON_MANAGER =
  /membership\.role !== "owner" && membership\.role !== "admin"\)\s*notFound\(\)/;

const NEW_ROUTES = [
  "app/[locale]/admin/products/new/page.tsx",
  "app/[locale]/admin/customers/new/page.tsx",
];
const EDIT_ROUTES = [
  "app/[locale]/admin/products/[id]/edit/page.tsx",
  "app/[locale]/admin/customers/[id]/edit/page.tsx",
];
const ALL_ROUTES = [...NEW_ROUTES, ...EDIT_ROUTES];

// ══ Every route reads the ACTIVE-tenant role and denies a non-manager ════════

for (const rel of ALL_ROUTES) {
  test(`${rel}: reads the active-tenant role and denies non owner/admin`, () => {
    const code = stripComments(readSrc(rel));
    assert.match(
      code,
      /getSessionContext\b/,
      "must read the session/membership to know the caller's role",
    );
    assert.match(
      code,
      /from "@\/lib\/auth\/session"/,
      "getSessionContext must come from the server-only session module",
    );
    assert.match(
      code,
      DENIES_NON_MANAGER,
      "must 404 any role that is not owner/admin (explicit allowlist)",
    );
  });
}

// ══ CREATE routes: gate is supabase-only, so mock stays the OPEN demo ════════

for (const rel of NEW_ROUTES) {
  test(`${rel}: the role gate is supabase-only (mock stays an open demo)`, () => {
    const code = stripComments(readSrc(rel));
    // The session read must sit behind a supabase-mode check, so mock never
    // touches auth and keeps rendering the demo form. Match the CALL site
    // (`await getSessionContext`), not the earlier import of the same name.
    const modeIdx = code.indexOf('getDataMode() === "supabase"');
    const sessionIdx = code.indexOf("await getSessionContext");
    assert.ok(modeIdx >= 0, "must branch on getDataMode() === 'supabase'");
    assert.ok(
      sessionIdx >= 0 && modeIdx < sessionIdx,
      "the supabase-mode check must precede (guard) the session read",
    );
    // Reads membership under RLS per request → must not be statically cached.
    assert.match(
      code,
      /export const dynamic = "force-dynamic"/,
      "must render per request so the role gate is never statically cached",
    );
  });
}

// ══ EDIT routes: already 404 in mock; gate runs BEFORE any edit-data fetch ═══

const EDIT_FETCH = new Map([
  ["app/[locale]/admin/products/[id]/edit/page.tsx", "getProduct("],
  ["app/[locale]/admin/customers/[id]/edit/page.tsx", "getCustomer("],
]);

for (const rel of EDIT_ROUTES) {
  test(`${rel}: keeps its mock 404 and denies the rep BEFORE fetching form data`, () => {
    const code = stripComments(readSrc(rel));
    // Mock has nothing to persist — the route stays 404 there.
    assert.match(
      code,
      /getDataMode\(\) !== "supabase"\)\s*notFound\(\)/,
      "edit routes must still 404 in mock mode",
    );
    // The role denial must run before the product/customer read, so a rep is
    // 404'd without the route doing (or leaking the timing of) that fetch.
    const denialIdx = code.search(DENIES_NON_MANAGER);
    const fetchIdx = code.indexOf(EDIT_FETCH.get(rel)!);
    assert.ok(denialIdx >= 0, "must contain the role denial");
    assert.ok(fetchIdx >= 0, `must fetch via ${EDIT_FETCH.get(rel)}`);
    assert.ok(
      denialIdx < fetchIdx,
      "the role denial must precede the edit-data fetch",
    );
  });
}
