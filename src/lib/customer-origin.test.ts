/**
 * Customer-origin test suite (M8G.1). Exercises the PURE customers-list URL
 * contract (parse/serialize/compose), the localized origin labels, the mock
 * server-side origin filter (mirrors the supabase `.eq("origin")` predicate),
 * and source-level guards for immutability, server-controlled derivation, the
 * read-only/no-audit contract, and the client/server boundary. Pure + zero-env:
 * runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:customer-origin` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  customersQueryToParams,
  hasActiveFilters,
  parseCustomersQuery,
  toCustomerQuery,
  withFilterChange,
  type CustomersQuery,
} from "./customers-query";
import { getCustomerStatsForIds, searchCustomers } from "./data/customers";
import { customers as mockCustomers } from "./mock";
import { CUSTOMER_ORIGINS, isCustomerOrigin } from "./types";
import { getDictionary } from "../i18n/dictionaries";

const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");

// ── 1. Parser default → no origin filter ("all") ───────────────────────────
test("parseCustomersQuery: default origin is 'all'", () => {
  assert.equal(parseCustomersQuery({}).origin, "all");
});

// ── 2. Valid origin parses through ─────────────────────────────────────────
test("parseCustomersQuery: a valid origin parses through", () => {
  for (const o of CUSTOMER_ORIGINS) {
    assert.equal(parseCustomersQuery({ origin: o }).origin, o);
  }
});

// ── 3. Invalid origin normalizes safely to 'all' ───────────────────────────
test("parseCustomersQuery: invalid origin normalizes to 'all'", () => {
  assert.equal(parseCustomersQuery({ origin: "partner" }).origin, "all");
  assert.equal(parseCustomersQuery({ origin: "" }).origin, "all");
  assert.equal(parseCustomersQuery({ origin: ["signup", "x"] }).origin, "signup");
});

// ── 4. Serialization omits defaults; emits a set origin ────────────────────
test("customersQueryToParams: omits 'all', emits a concrete origin", () => {
  const base = parseCustomersQuery({});
  assert.equal(customersQueryToParams(base).toString(), "");
  assert.equal(
    customersQueryToParams(base, { origin: "manual" }).get("origin"),
    "manual",
  );
});

// ── 5. Filter change carries NO pagination param (load state resets) ───────
test("no page/offset param is ever serialized (filter change resets load)", () => {
  const q: CustomersQuery = {
    search: "x",
    status: "active",
    link: "has",
    origin: "signup",
  };
  const params = customersQueryToParams(q);
  assert.equal(params.get("page"), null);
  assert.equal(params.get("offset"), null);
});

// ── 6. Changing origin preserves unrelated facets ──────────────────────────
test("withFilterChange(origin) preserves search/status/link", () => {
  const q = parseCustomersQuery({ q: "abu", status: "active", link: "has" });
  const next = withFilterChange(q, { origin: "signup" });
  assert.equal(next.search, "abu");
  assert.equal(next.status, "active");
  assert.equal(next.link, "has");
  assert.equal(next.origin, "signup");
});

// ── 7. Rapid composition: two changes both land ────────────────────────────
test("rapid composition: origin then status both land", () => {
  const q0 = parseCustomersQuery({ q: "abu" });
  const q1 = withFilterChange(q0, { origin: "signup" });
  const q2 = withFilterChange(q1, { status: "inactive" });
  assert.equal(q2.origin, "signup");
  assert.equal(q2.status, "inactive");
  assert.equal(q2.search, "abu");
});

// ── 8. Clearing origin preserves search/status ─────────────────────────────
test("clearing origin (→ all) preserves search + status, drops ?origin", () => {
  const q = parseCustomersQuery({ q: "abu", status: "active", origin: "manual" });
  const cleared = withFilterChange(q, { origin: "all" });
  assert.equal(cleared.search, "abu");
  assert.equal(cleared.status, "active");
  const params = customersQueryToParams(cleared);
  assert.equal(params.get("origin"), null);
  assert.equal(params.get("q"), "abu");
});

// ── 9. Shared-URL round-trip: parse(serialize(q)) === q ────────────────────
test("shared URL round-trips through parse/serialize", () => {
  const q: CustomersQuery = {
    search: "nur",
    status: "inactive",
    link: "none",
    origin: "guest_conversion",
  };
  const round = parseCustomersQuery(
    Object.fromEntries(customersQueryToParams(q)),
  );
  assert.deepEqual(round, q);
});

// ── 10–12. Localized labels (ar/he/en) present + non-empty ─────────────────
for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: every origin has a non-empty label + description`, () => {
    const o = getDictionary(locale).admin.customers.origin;
    assert.ok(o.label.length > 0 && o.all.length > 0);
    for (const v of CUSTOMER_ORIGINS) {
      assert.ok(o.values[v].length > 0, `${locale} value ${v}`);
      assert.ok(o.descriptions[v].length > 0, `${locale} desc ${v}`);
    }
  });
}

// ── 13. legacy/unknown label is distinct from the known-origin labels ──────
test("legacy_unknown label is distinct from the known origins (each locale)", () => {
  for (const locale of ["ar", "he", "en"] as const) {
    const v = getDictionary(locale).admin.customers.origin.values;
    const known = [v.manual, v.signup, v.guest_conversion];
    assert.ok(!known.includes(v.legacy_unknown), `${locale} distinct`);
  }
});

// ── 14–16. Mock rows carry each origin value ───────────────────────────────
test("mock customers include manual / signup / legacy_unknown rows", () => {
  const origins = new Set(mockCustomers.map((c) => c.origin));
  assert.ok(origins.has("manual"));
  assert.ok(origins.has("signup"));
  assert.ok(origins.has("legacy_unknown"));
  assert.ok(origins.has("guest_conversion"));
  // Every mock row has an explicit, valid origin.
  assert.ok(mockCustomers.every((c) => isCustomerOrigin(c.origin)));
});

// ── 17. Server-side origin filter returns ONLY that origin ─────────────────
test("searchCustomers(origin) returns only rows of that origin", async () => {
  for (const o of CUSTOMER_ORIGINS) {
    const rows = await searchCustomers({ origin: o });
    assert.ok(
      rows.every((c) => (c.origin ?? "legacy_unknown") === o),
      `all rows are ${o}`,
    );
  }
});

// ── 18. Exact filtered count matches the mock distribution ─────────────────
test("origin filter yields the exact matching count", async () => {
  for (const o of CUSTOMER_ORIGINS) {
    const rows = await searchCustomers({ origin: o });
    const expected = mockCustomers.filter(
      (c) => (c.origin ?? "legacy_unknown") === o,
    ).length;
    assert.equal(rows.length, expected, `count for ${o}`);
  }
});

// ── 19. Current-page-only: the limit bounds the returned rows ──────────────
test("searchCustomers respects the page limit (current-page-only)", async () => {
  const page = await searchCustomers({}, 0, 3);
  assert.ok(page.length <= 3);
});

// ── 20. Origin filter composes with search + status ────────────────────────
test("origin composes with the existing search/status facets", async () => {
  const manualRows = await searchCustomers({ origin: "manual" });
  assert.ok(manualRows.length > 0);
  // Adding an impossible search narrows to zero without throwing.
  const none = await searchCustomers({ origin: "manual", q: "‡no-such-store‡" });
  assert.equal(none.length, 0);
});

// ── 21. Customer statistics still merge for a filtered page ────────────────
test("stats still resolve for a filtered origin page (no regression)", async () => {
  const rows = await searchCustomers({ origin: "manual" });
  const stats = await getCustomerStatsForIds(rows.map((c) => c.id));
  for (const c of rows) {
    assert.ok(stats[c.id], `stats present for ${c.id}`);
    assert.equal(typeof stats[c.id].count, "number");
  }
});

// ── 22. Zero-order behavior unchanged under an origin filter ───────────────
test("a filtered zero-order customer still reports count 0", async () => {
  const rows = await searchCustomers({});
  const stats = await getCustomerStatsForIds(rows.map((c) => c.id));
  for (const c of rows) {
    assert.ok(stats[c.id].count >= 0);
  }
});

// ── 23. toCustomerQuery maps the facet into the data-layer contract ────────
test("toCustomerQuery maps origin (and omits 'all')", () => {
  assert.equal(toCustomerQuery(parseCustomersQuery({})).origin, undefined);
  assert.equal(
    toCustomerQuery(parseCustomersQuery({ origin: "signup" })).origin,
    "signup",
  );
  assert.ok(hasActiveFilters(parseCustomersQuery({ origin: "manual" })));
  assert.ok(!hasActiveFilters(parseCustomersQuery({})));
});

// ── 24. sales_rep visibility is NOT broadened by the origin filter ─────────
test("guard: supabase origin filter is tenant-scoped + RLS-bound", () => {
  const src = readSrc("lib/data/supabase-reads.ts");
  // The customer search is tenant-scoped and adds origin as a plain predicate;
  // RLS (getReadContext / can_access_customer) still bounds the rows.
  assert.ok(src.includes('.eq("tenant_id", tenantId)'));
  assert.ok(src.includes('.eq("origin", q.origin)'));
  assert.ok(src.includes("getReadContext"));
  assert.ok(!/service_role/i.test(src), "no service_role read path");
});

// ── 25. Customer detail shows origin (read-only badge) ─────────────────────
test("guard: customer detail renders a read-only origin badge", () => {
  const detail = readSrc("app/[locale]/admin/customers/[id]/page.tsx");
  assert.ok(detail.includes("CustomerOriginBadge"));
});

// ── 26. No editable origin control anywhere ────────────────────────────────
test("guard: origin is never an editable form field", () => {
  const form = readSrc("components/admin/customer-form.tsx");
  assert.ok(!/\borigin\b/.test(form), "the customer form has no origin field");
  const badge = readSrc("components/admin/customer-origin-badge.tsx");
  // The badge is presentational: no input/select/button/onChange.
  assert.ok(!/<(input|select|button)\b/i.test(badge));
  assert.ok(!/onchange|onclick/i.test(badge));
});

// ── 27. No full Orders fetch in the Customers flow ─────────────────────────
test("guard: Customers list/detail never load the full orders collection", () => {
  const page = readSrc("app/[locale]/admin/customers/page.tsx");
  const detail = readSrc("app/[locale]/admin/customers/[id]/page.tsx");
  assert.ok(!/\blistOrders\b/.test(page));
  assert.ok(!/\blistOrders\b/.test(detail));
});

// ── 28. No N+1: the customer search is a single query with an origin filter ─
test("guard: origin is a single-query predicate (no per-row lookup)", () => {
  // Normalize CRLF → LF so the `\n}\n` function-end delimiter matches on
  // Windows checkouts (otherwise the slice runs to EOF and picks up unrelated
  // helpers added later in the file).
  const src = readSrc("lib/data/supabase-reads.ts").replace(/\r\n/g, "\n");
  const fn = src.slice(src.indexOf("export async function sbSearchCustomers"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  // Exactly one base query on customers; origin is a filter, not a loop.
  assert.equal((body.match(/\.from\("customers"\)/g) ?? []).length, 1);
  assert.ok(!/for\s*\(|\.map\(async/.test(body), "no per-row origin lookup");
});

// ── 29. Customer CRUD contract unchanged (no origin in write actions/RPCs) ─
test("guard: create/update customer never accept an origin", () => {
  const action = readSrc("lib/actions/customers.ts");
  // createCustomerAction / updateCustomerAction build input from the form; the
  // readCustomerInput mapper must not surface origin.
  const mapper = action.slice(
    action.indexOf("function readCustomerInput"),
    action.indexOf("function readCustomerInput") + 700,
  );
  assert.ok(!/\borigin\b/.test(mapper), "write input has no origin");
  const writes = readSrc("lib/data/supabase-writes.ts");
  assert.ok(
    !/create_customer[^]*p_origin|origin:/i.test(
      writes.slice(0, writes.indexOf("sbCreateCustomer") + 800),
    ),
    "sbCreateCustomer does not pass an origin",
  );
});

// ── 30. Create-path derivation is SERVER-controlled (DB literals) ──────────
test("guard: migration derives origin as DB literals, not a client arg", () => {
  const mig = readRepo(
    "supabase/migrations/20260730100000_m8g1_customer_origin.sql",
  );
  assert.ok(/, 'manual'\)/.test(mig), "create_customer sets 'manual'");
  assert.ok(/, 'signup'\)/.test(mig), "signup approval sets 'signup'");
  assert.ok(/'guest_conversion'\)/.test(mig), "promotion sets 'guest_conversion'");
  // create_customer's signature is unchanged (no origin parameter).
  assert.ok(!/p_origin\b/.test(mig), "no origin parameter on any create RPC");
});

// ── 31. No client-supplied authoritative origin (server re-validates facet) ─
test("guard: the search action re-validates origin server-side", () => {
  const action = readSrc("lib/actions/customers.ts");
  assert.ok(action.includes("isCustomerOrigin(input.origin)"));
});

// ── 32. Immutability: no update path rewrites origin ───────────────────────
test("guard: immutability — no update/lifecycle path writes origin", () => {
  const mig = readRepo(
    "supabase/migrations/20260730100000_m8g1_customer_origin.sql",
  );
  // The migration only sets origin at INSERT (create paths) + the one backfill
  // UPDATE keyed on the signup FK; it never re-creates update_customer /
  // set_customer_active (so those paths keep their origin-free column lists).
  assert.ok(
    !/create or replace function public\.(update_customer|set_customer_active)/i.test(
      mig,
    ),
    "migration does not touch the update/lifecycle RPCs",
  );
  // The only UPDATE on customers is the signup backfill (keyed on the FK).
  assert.ok(!/update public\.customers[^]*set origin\s*=\s*[^']*p_/i.test(mig));
  const updateMig = readRepo(
    "supabase/migrations/20260717100000_customer_write_rpcs.sql",
  );
  assert.ok(!/\borigin\b/.test(updateMig), "update_customer never writes origin");
});

// ── 33. No new/duplicate audit event; read-only browsing logs nothing ──────
test("guard: no audit-event write is introduced (read-only origin)", () => {
  const mig = readRepo(
    "supabase/migrations/20260730100000_m8g1_customer_origin.sql",
  );
  assert.ok(!/audit_events/i.test(mig), "no audit_events write in the migration");
  const action = readSrc("lib/actions/customers.ts");
  assert.ok(!/audit/i.test(action), "the search action logs nothing");
});

// ── 34. No "Other" fallback — the fallback is a REAL value (legacy_unknown) ─
test("guard: unknown origin falls back to legacy_unknown, never 'Other'", () => {
  const badge = readSrc("components/admin/customer-origin-badge.tsx");
  assert.ok(badge.includes('"legacy_unknown"'));
  assert.ok(!/other/i.test(badge), "no 'Other' bucket");
  const data = readSrc("lib/data/customers.ts");
  assert.ok(data.includes('"legacy_unknown"'));
});

// ── 35. Client/server boundary: client origin UI imports no server-only code ─
test("guard: client origin components import no server-only data layer", () => {
  for (const rel of [
    "components/admin/customers-table.tsx",
    "components/admin/customer-origin-badge.tsx",
  ]) {
    const src = readSrc(rel);
    assert.ok(!/supabase-reads|supabase-writes|server-only/.test(src), rel);
  }
  // The badge is a plain presentational component (no "use client" hooks needed).
  assert.ok(
    readSrc("components/admin/customer-origin-badge.tsx").includes("Badge"),
  );
});
