/**
 * Order Timeline test suite (M8H.3). Exercises the PRODUCTION contract:
 *   • the client-safe metadata projection (mirrors the M8H.1 SQL key allowlist),
 *     including the LEGACY `order.delivered` seed row whose `order_number` must
 *     never reach the client;
 *   • the validated before → after status transition + the detail lines;
 *   • the mock data-layer page (bounded, keyset-paginated, no dup / no skip,
 *     page-scoped actor resolution);
 *   • the read-only Server Action (no audit write, opaque cursor, safe failure);
 *   • timezone rendering (same instant, different tenant zones);
 *   • source-level guards for the server read / action / UI / RLS contract.
 *
 * Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:order-timeline` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { loadOrderTimelineAction } from "./actions/order-timeline";
import { decodeTimelineCursor, type TimelineActor } from "./customer-timeline";
import {
  getOrderTimelinePage,
  safeInitialOrderTimeline,
} from "./data/order-timeline";
import { orderAuditEvents } from "./mock";
import { orderAuditEventLabel, ORDER_AUDIT_EVENT_KEYS } from "./order-audit";
import {
  buildOrderTimelineEvent,
  clientSafeOrderMetadata,
  orderStatusTransition,
  orderTimelineDetails,
  type OrderTimelineEvent,
} from "./order-timeline";
import { formatTenantDateTime } from "./time";
import { getDictionary } from "../i18n/dictionaries";

const LOCALES = ["ar", "he", "en"] as const;
const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8");
/** Strip block + line comments so a guard scans CODE, not the doc-comments that
 * (correctly) describe the very invariants we forbid in code. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const EN = getDictionary("en");
/** The mock order with the fullest history (create → status → update → unknown). */
const MOCK_ORDER = "o1043";
const JLM = "Asia/Jerusalem";

const NO_ACTOR: TimelineActor = { kind: "unknown" };
const ev = (
  eventType: string,
  metadata: Record<string, unknown>,
): OrderTimelineEvent =>
  buildOrderTimelineEvent({
    id: "1",
    eventType,
    createdAt: "2026-07-01T09:30:00Z",
    actor: NO_ACTOR,
    metadata,
  });

// ══ 1. The client-safe metadata projection ════════════════════════════════

test("projection keeps ONLY the rendered keys for order.created", () => {
  const out = clientSafeOrderMetadata("order.created", {
    source: "sales_visit",
    initiator_kind: "authenticated_user",
    initial_status: "new",
    customer_kind: "existing",
    item_count: 5,
  });
  // initiator_kind + item_count are rendered; the rest are not projected.
  assert.deepEqual(out, { initiator_kind: "authenticated_user", item_count: 5 });
});

test("projection keeps the safe order.status_changed enums", () => {
  const out = clientSafeOrderMetadata("order.status_changed", {
    from_status: "new",
    to_status: "confirmed",
    inventory_effect: "reserved",
  });
  assert.deepEqual(out, {
    from_status: "new",
    to_status: "confirmed",
    inventory_effect: "reserved",
  });
});

test("projection keeps the safe order.updated counts and filters changed_fields", () => {
  const out = clientSafeOrderMetadata("order.updated", {
    changed_fields: ["items", "notes", "price", "customer_id"],
    item_count_before: 4,
    item_count_after: 5,
  });
  assert.deepEqual(out, {
    changed_fields: ["items", "notes"], // unknown field keys dropped
    item_count_before: 4,
    item_count_after: 5,
  });
});

test("projection keeps link_kind for order.customer_linked", () => {
  assert.deepEqual(
    clientSafeOrderMetadata("order.customer_linked", {
      link_kind: "guest_conversion",
    }),
    { link_kind: "guest_conversion" },
  );
});

test("projection DROPS any key outside the per-event allowlist", () => {
  const out = clientSafeOrderMetadata("order.status_changed", {
    from_status: "new",
    to_status: "confirmed",
    // None of these may ever cross the wire, whatever a producer did.
    order_number: "MDF-1043",
    customer_snapshot: { name: "Store", phone: "050" },
    token_hash: "deadbeef",
    total: 1234.5,
    notes: "private note",
    product_id: "p01",
  });
  assert.deepEqual(out, { from_status: "new", to_status: "confirmed" });
});

test("an UNKNOWN event type projects to {} — no raw metadata escapes", () => {
  // This is the REAL legacy row in supabase/seed.sql (order.delivered carrying
  // order_number), not a hypothetical.
  const out = clientSafeOrderMetadata("order.delivered", {
    order_number: "MDF-1043",
  });
  assert.deepEqual(out, {});
});

test("the legacy seed event is mirrored in the mock and stays inert", () => {
  const legacy = orderAuditEvents.find((e) => e.eventType === "order.delivered");
  assert.ok(legacy, "mock carries the legacy unrecognized order event");
  assert.equal(legacy.metadata.order_number, "MDF-1043");
  const built = buildOrderTimelineEvent({
    id: legacy.id,
    eventType: legacy.eventType,
    createdAt: legacy.createdAt,
    actor: NO_ACTOR,
    metadata: legacy.metadata,
  });
  assert.deepEqual(built.metadata, {});
  assert.equal(built.sensitivity, "medium"); // unknown is never under-classified
  assert.equal(orderAuditEventLabel(built.eventType, EN), EN.audit.unknownEvent);
  assert.deepEqual(orderTimelineDetails(built, EN), []);
});

// ══ 1b. VALUE-SAFE projection (P2) — malformed values never cross the wire ══
// The projection is the security boundary, not the renderer: a malformed value
// nested under an allowlisted key must be omitted BEFORE it reaches the client.

/** Assert a projected metadata object contains ONLY safe leaves: strings
 * (closed enums), finite non-negative integers, or arrays of strings. No nested
 * object, no array-of-object, ever — whatever the input tried to smuggle in. */
function assertOnlySafeLeaves(meta: Record<string, unknown>) {
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      for (const el of v) {
        assert.equal(typeof el, "string", `${k}[] element must be a string`);
      }
    } else {
      assert.ok(
        typeof v === "string" ||
          (typeof v === "number" && Number.isInteger(v) && v >= 0),
        `${k} must be a closed enum string or a safe integer, got ${typeof v}`,
      );
    }
  }
}

test("count fields REJECT a nested object (the confirmed P2 payload)", () => {
  // The exact shape Codex flagged: a token nested under a numeric key.
  const out = clientSafeOrderMetadata("order.updated", {
    changed_fields: ["notes"],
    item_count_before: { token_hash: "secret" },
    item_count_after: ["private"],
  });
  assert.deepEqual(out, { changed_fields: ["notes"] });
  assert.ok(!("item_count_before" in out));
  assert.ok(!("item_count_after" in out));
  assertOnlySafeLeaves(out);
});

test("count fields reject array / string / boolean / NaN / Infinity / negative / float", () => {
  for (const bad of [
    [1, 2, 3],
    { a: 1 },
    "5",
    true,
    NaN,
    Infinity,
    -Infinity,
    -1,
    3.5,
    Number.MAX_SAFE_INTEGER, // above the sane bound
    null,
    undefined,
  ]) {
    const out = clientSafeOrderMetadata("order.created", {
      initiator_kind: "authenticated_user",
      item_count: bad,
    });
    assert.ok(!("item_count" in out), `item_count must drop ${String(bad)}`);
    // The valid sibling still survives.
    assert.equal(out.initiator_kind, "authenticated_user");
  }
});

test("count fields ACCEPT a valid non-negative integer (incl. 0)", () => {
  for (const good of [0, 1, 5, 200]) {
    const out = clientSafeOrderMetadata("order.created", { item_count: good });
    assert.equal(out.item_count, good);
  }
});

test("enum fields reject a number, an unknown string, an object, and null", () => {
  for (const bad of [5, "not_a_channel", { x: 1 }, null, ["authenticated_user"]]) {
    const out = clientSafeOrderMetadata("order.created", { initiator_kind: bad });
    assert.ok(
      !("initiator_kind" in out),
      `initiator_kind must drop ${JSON.stringify(bad)}`,
    );
  }
  // status + inventory_effect + link_kind reject the same way.
  const s = clientSafeOrderMetadata("order.status_changed", {
    from_status: "new",
    to_status: "not_a_status",
    inventory_effect: { nested: "x" },
  });
  assert.deepEqual(s, { from_status: "new" }); // only the valid enum survives
  const l = clientSafeOrderMetadata("order.customer_linked", {
    link_kind: "../../etc/passwd",
  });
  assert.deepEqual(l, {});
});

test("enum fields ACCEPT only their exact closed values", () => {
  assert.equal(
    clientSafeOrderMetadata("order.created", {
      initiator_kind: "showcase_guest",
    }).initiator_kind,
    "showcase_guest",
  );
  const s = clientSafeOrderMetadata("order.status_changed", {
    from_status: "preparing",
    to_status: "delivered",
    inventory_effect: "restored",
  });
  assert.deepEqual(s, {
    from_status: "preparing",
    to_status: "delivered",
    inventory_effect: "restored",
  });
});

test("changed_fields rejects a non-array, nested values, and arbitrary strings; dedupes", () => {
  // Non-array → dropped entirely.
  const notArray = clientSafeOrderMetadata("order.updated", {
    changed_fields: { items: true },
  });
  assert.ok(!("changed_fields" in notArray));
  // Arbitrary strings + nested objects + a sensitive key → filtered to the
  // known display-safe identifiers only; duplicates collapsed.
  const mixed = clientSafeOrderMetadata("order.updated", {
    changed_fields: [
      "items",
      "items", // duplicate
      "price", // not a display-safe field key
      "notes",
      { token_hash: "secret" }, // nested object
      ["nested"], // nested array
      "customer_id",
      42,
    ],
  });
  assert.deepEqual(mixed.changed_fields, ["items", "notes"]);
  assertOnlySafeLeaves(mixed);
});

test("a deeply nested sensitive object under every key is fully stripped", () => {
  const deep = {
    a: { b: { c: { token_hash: "x", customer_snapshot: { phone: "050" } } } },
  };
  const out = clientSafeOrderMetadata("order.updated", {
    changed_fields: [deep, "notes"],
    item_count_before: deep,
    item_count_after: { nested: deep },
  });
  assert.deepEqual(out, { changed_fields: ["notes"] });
  assertOnlySafeLeaves(out);
  // The sensitive strings appear NOWHERE in the serialized output.
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /token_hash|customer_snapshot|050/);
});

test("a malformed KNOWN event keeps the event but forwards NO malformed value", () => {
  const built = buildOrderTimelineEvent({
    id: "1",
    eventType: "order.status_changed", // known event
    createdAt: "2026-07-01T09:30:00Z",
    actor: NO_ACTOR,
    metadata: {
      from_status: { evil: "obj" },
      to_status: 999,
      inventory_effect: ["array"],
      // a stray sensitive key that is not even allowlisted
      token_hash: "secret",
    },
  });
  // The event survives (title still renders) but carries zero metadata.
  assert.equal(built.eventType, "order.status_changed");
  assert.deepEqual(built.metadata, {});
  assertOnlySafeLeaves(built.metadata);
});

test("CLIENT-BOUNDARY proof: the produced page payload has no malformed/nested value", async () => {
  // Inspect the REAL produced OrderTimelinePage (the object that crosses the
  // Server Component / Server Action boundary) — not a DOM render.
  const pageOut = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 50 });
  const json = JSON.stringify(pageOut);
  assert.doesNotMatch(json, /token_hash|customer_snapshot|order_number|MDF-/);
  for (const e of pageOut.events) {
    assertOnlySafeLeaves(e.metadata);
  }
});

test("projection tolerates null/undefined metadata", () => {
  assert.deepEqual(clientSafeOrderMetadata("order.created", null), {});
  assert.deepEqual(clientSafeOrderMetadata("order.created", undefined), {});
});

test("buildOrderTimelineEvent stamps category=order and the M8H.1 sensitivity", () => {
  const e = ev("order.updated", { changed_fields: ["items"] });
  assert.equal(e.category, "order");
  assert.equal(e.sensitivity, "medium");
  assert.equal(ev("order.created", {}).sensitivity, "low");
});

// ══ 2. before → after status transition ═══════════════════════════════════

test("orderStatusTransition returns the validated pair", () => {
  const e = ev("order.status_changed", {
    from_status: "confirmed",
    to_status: "cancelled",
    inventory_effect: "restored",
  });
  assert.deepEqual(orderStatusTransition(e), {
    from: "confirmed",
    to: "cancelled",
  });
});

test("orderStatusTransition is null for a non-status event", () => {
  assert.equal(orderStatusTransition(ev("order.created", {})), null);
});

test("orderStatusTransition REFUSES a bogus status (never renders a raw value)", () => {
  const e = ev("order.status_changed", {
    from_status: "new",
    to_status: "<script>alert(1)</script>",
  });
  assert.equal(orderStatusTransition(e), null);
});

test("orderStatusTransition is null for an unknown event type", () => {
  const e = ev("order.delivered", { from_status: "new", to_status: "confirmed" });
  assert.equal(orderStatusTransition(e), null);
});

// ══ 3. Detail lines (localized, PII-safe, no duplication) ═════════════════

test("status_changed details show the stock effect but NOT the transition prose", () => {
  const e = ev("order.status_changed", {
    from_status: "new",
    to_status: "confirmed",
    inventory_effect: "reserved",
  });
  const lines = orderTimelineDetails(e, EN);
  // The transition is rendered as chips; the prose form must not be duplicated.
  assert.equal(lines.length, 1);
  assert.match(lines[0], /stock|reserv/i);
  assert.doesNotMatch(lines.join(" "), /→/);
});

test("status_changed with inventory_effect 'none' produces NO detail line", () => {
  const e = ev("order.status_changed", {
    from_status: "preparing",
    to_status: "delivered",
    inventory_effect: "none",
  });
  assert.deepEqual(orderTimelineDetails(e, EN), []);
});

test("created details name the honest channel + the line count", () => {
  const e = ev("order.created", {
    initiator_kind: "showcase_guest",
    item_count: 6,
  });
  const text = orderTimelineDetails(e, EN).join(" · ");
  assert.match(text, /guest/i);
  assert.match(text, /6/);
  // A NULL actor is never silently "System".
  assert.doesNotMatch(text, /system/i);
});

test("updated details list the changed FIELDS, never the values", () => {
  const e = ev("order.updated", {
    changed_fields: ["items", "notes"],
    item_count_before: 4,
    item_count_after: 5,
  });
  const text = orderTimelineDetails(e, EN).join(" · ");
  assert.match(text, /Items/);
  assert.match(text, /Notes/);
  assert.match(text, /4/);
  assert.match(text, /5/);
});

test("customer_linked distinguishes guest conversion from an existing customer", () => {
  const guest = orderTimelineDetails(
    ev("order.customer_linked", { link_kind: "guest_conversion" }),
    EN,
  ).join(" ");
  const existing = orderTimelineDetails(
    ev("order.customer_linked", { link_kind: "existing_customer" }),
    EN,
  ).join(" ");
  assert.ok(guest.length > 0 && existing.length > 0);
  assert.notEqual(guest, existing);
});

test("a malformed link_kind renders NO line rather than a raw value", () => {
  const e = ev("order.customer_linked", { link_kind: "../../etc/passwd" });
  assert.deepEqual(orderTimelineDetails(e, EN), []);
});

test("every event key has a non-empty label + details in ar/he/en", () => {
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    for (const key of ORDER_AUDIT_EVENT_KEYS) {
      const label = orderAuditEventLabel(key, dict);
      assert.ok(label.length > 0, `${locale}/${key} label`);
      assert.notEqual(label, dict.audit.unknownEvent, `${locale}/${key}`);
    }
    // The unknown fallback is localized too (never a raw event id).
    assert.ok(dict.audit.unknownEvent.length > 0);
    assert.notEqual(orderAuditEventLabel("order.delivered", dict), "order.delivered");
    // Timeline chrome is localized in every language.
    for (const s of [
      dict.audit.timeline.heading,
      dict.audit.timeline.empty,
      dict.audit.timeline.emptyHint,
      dict.audit.timeline.loading,
      dict.audit.timeline.loadMore,
      dict.audit.timeline.loadError,
      dict.audit.timeline.error,
      dict.audit.timeline.retry,
      dict.audit.timeline.actorMember,
      dict.audit.timeline.actorFormer,
      dict.audit.timeline.actorUnknown,
      dict.audit.timeline.by,
    ]) {
      assert.ok(typeof s === "string" && s.length > 0);
    }
    assert.match(dict.audit.timeline.by, /\{actor\}/);
  }
});

test("details are LOCALIZED — ar/he differ from en", () => {
  const e = ev("order.status_changed", {
    from_status: "new",
    to_status: "confirmed",
    inventory_effect: "reserved",
  });
  const en = orderTimelineDetails(e, getDictionary("en")).join(" ");
  const ar = orderTimelineDetails(e, getDictionary("ar")).join(" ");
  const he = orderTimelineDetails(e, getDictionary("he")).join(" ");
  assert.notEqual(ar, en);
  assert.notEqual(he, en);
  assert.ok(ar.length > 0 && he.length > 0);
});

// ══ 4. The mock data-layer page: bounded, keyset, no dup / no skip ════════

test("the first page is newest-first (created_at DESC, id DESC)", async () => {
  const page = await getOrderTimelinePage({ orderId: MOCK_ORDER });
  assert.ok(page.events.length > 0);
  for (let i = 1; i < page.events.length; i += 1) {
    const prev = Date.parse(page.events[i - 1].createdAt);
    const cur = Date.parse(page.events[i].createdAt);
    assert.ok(prev >= cur, "descending by created_at");
    if (prev === cur) {
      assert.ok(
        BigInt(page.events[i - 1].id) > BigInt(page.events[i].id),
        "id DESC tie-break",
      );
    }
  }
});

test("page size is BOUNDED and hasMore/nextCursor agree", async () => {
  const page = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 2 });
  assert.equal(page.events.length, 2);
  assert.equal(page.hasMore, true);
  assert.ok(page.nextCursor);
  // The cursor is opaque but decodes to the LAST row of the page.
  const decoded = decodeTimelineCursor(page.nextCursor);
  assert.deepEqual(decoded, {
    createdAt: page.events[1].createdAt,
    id: page.events[1].id,
  });
});

test("paging through the whole history yields NO duplicate and NO skipped row", async () => {
  const expected = orderAuditEvents
    .filter((e) => e.orderId === MOCK_ORDER)
    .map((e) => e.id)
    .sort((a, b) => Number(b) - Number(a));

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const page: Awaited<ReturnType<typeof getOrderTimelinePage>> =
      await getOrderTimelinePage({
        orderId: MOCK_ORDER,
        cursor,
        pageSize: 2,
      });
    seen.push(...page.events.map((e) => e.id));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
    assert.ok(cursor, "hasMore implies a cursor");
  }
  assert.deepEqual(seen, expected, "every row exactly once, in order");
  assert.equal(new Set(seen).size, seen.length, "no duplicates");
});

test("the last page reports hasMore=false and a null cursor", async () => {
  const all = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 50 });
  assert.equal(all.hasMore, false);
  assert.equal(all.nextCursor, null);
});

test("an oversized pageSize is CLAMPED (never an unbounded fetch)", async () => {
  const page = await getOrderTimelinePage({
    orderId: MOCK_ORDER,
    pageSize: 100_000,
  });
  assert.ok(page.events.length <= 50);
});

test("a malformed/tampered cursor falls back to the FIRST page (never throws)", async () => {
  const first = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 3 });
  for (const bad of ["not-base64!!", "", "x".repeat(400), "Zm9vfGJhcg"]) {
    const page = await getOrderTimelinePage({
      orderId: MOCK_ORDER,
      cursor: bad,
      pageSize: 3,
    });
    assert.deepEqual(
      page.events.map((e) => e.id),
      first.events.map((e) => e.id),
    );
  }
});

test("an order with NO events returns an honest EMPTY page (not an error)", async () => {
  const page = await getOrderTimelinePage({ orderId: "o1047" });
  assert.deepEqual(page, { events: [], nextCursor: null, hasMore: false });
});

test("an unknown order id returns empty — never another order's history", async () => {
  const page = await getOrderTimelinePage({ orderId: "does-not-exist" });
  assert.equal(page.events.length, 0);
});

test("the page is scoped to ONE order (no cross-order bleed)", async () => {
  const a = await getOrderTimelinePage({ orderId: "o1043", pageSize: 50 });
  const b = await getOrderTimelinePage({ orderId: "o1041", pageSize: 50 });
  const aIds = new Set(a.events.map((e) => e.id));
  assert.ok(a.events.length > 0 && b.events.length > 0);
  for (const e of b.events) assert.ok(!aIds.has(e.id), "no shared rows");
});

test("actor resolution is page-scoped: named / former / unknown", async () => {
  const page = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 50 });
  const kinds = new Set(page.events.map((e) => e.actor.kind));
  // u-owner resolves (named); u-admin is absent from the roster (former);
  // a null actor is unknown. All three fallbacks are exercised by the demo data.
  assert.ok(kinds.has("named"));
  assert.ok(kinds.has("former"));
  assert.ok(kinds.has("unknown"));
  for (const e of page.events) {
    if (e.actor.kind === "named") {
      assert.equal(e.actor.label, "owner@madaf.local");
    }
    // A raw uuid/user-id must never become the display label.
    const label = e.actor.kind === "named" ? e.actor.label : "";
    assert.doesNotMatch(label, /^u-/);
  }
});

test("no rendered event carries a raw/forbidden metadata key", async () => {
  const page = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 50 });
  const FORBIDDEN = [
    "order_number",
    "customer_snapshot",
    "token_hash",
    "notes",
    "total",
    "source",
    "initial_status",
  ];
  for (const e of page.events) {
    for (const k of FORBIDDEN) {
      assert.ok(!(k in e.metadata), `${e.eventType} must not carry ${k}`);
    }
  }
});

// ══ 4b. Isolated initial read (P1) — a Timeline failure is CONTAINED ═══════
// safeInitialOrderTimeline is the exact wrapper the Order Details page uses for
// the OPTIONAL first Timeline read. It must NEVER throw — a failure becomes
// { ok: false } with no backend text — so the required Order Details render can
// never be rejected by a Timeline read.

test("a THROWING initial read is contained as { ok: false } (never rejects)", async () => {
  const res = await safeInitialOrderTimeline(async () => {
    throw new Error("PGRST500: relation secret_table leaked; connection=postgres://u:p@h");
  });
  assert.deepEqual(res, { ok: false });
});

test("the contained failure carries NO backend error text", async () => {
  const secret = "PGRST500 relation secret; postgres://user:pw@host/db";
  const res = await safeInitialOrderTimeline(async () => {
    throw new Error(secret);
  });
  // The only thing the client learns is that it failed — never why.
  assert.equal(JSON.stringify(res), JSON.stringify({ ok: false }));
  assert.doesNotMatch(JSON.stringify(res), /PGRST|postgres:|secret|host/);
});

test("a synchronously-throwing thunk is also contained", async () => {
  const res = await safeInitialOrderTimeline(() => {
    throw new Error("boom");
  });
  assert.deepEqual(res, { ok: false });
});

test("a successful initial read passes the real first page through unchanged", async () => {
  const page = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 3 });
  const res = await safeInitialOrderTimeline(() =>
    getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 3 }),
  );
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.page);
  assert.deepEqual(
    res.ok ? res.page.events.map((e) => e.id) : [],
    page.events.map((e) => e.id),
  );
  // The safe projection still ran on this path (no malformed/nested value).
  if (res.ok) {
    for (const e of res.page.events) assertOnlySafeLeaves(e.metadata);
  }
});

test("guard: the page ISOLATES the timeline read but not the required reads", () => {
  const src = stripComments(readSrc("app/[locale]/admin/orders/[id]/page.tsx"));
  // The optional timeline goes through the safe wrapper...
  assert.match(src, /safeInitialOrderTimeline\(\s*\(\)\s*=>/);
  assert.match(src, /getOrderTimelinePage\(\{ orderId: order\.id \}\)/);
  assert.match(src, /initial=\{timeline\}/);
  // ...while the REQUIRED reads stay in a plain Promise.all (they must still
  // fail the page if they fail — they are NOT wrapped in the safe helper).
  assert.match(src, /Promise\.all\(\[/);
  const requiredBlock = src.slice(
    src.indexOf("Promise.all(["),
    src.indexOf("]);", src.indexOf("Promise.all([")),
  );
  for (const req of [
    "getCustomer(",
    "listDocumentsForOrder(",
    "listProducts(",
    "listCategories(",
  ]) {
    assert.ok(requiredBlock.includes(req), `${req} stays a required read`);
  }
  assert.ok(
    !requiredBlock.includes("safeInitialOrderTimeline"),
    "required reads are NOT swallowed by the timeline isolation",
  );
});

// ══ 5. The read-only Server Action ════════════════════════════════════════

test("the action returns a bounded page for a valid order", async () => {
  const res = await loadOrderTimelineAction({ orderId: MOCK_ORDER });
  assert.equal(res.ok, true);
  assert.ok(res.page);
  assert.ok(res.page.events.length > 0);
});

test("the action REJECTS an implausible order id (no query is issued)", async () => {
  for (const bad of ["", "../../etc/passwd", "a".repeat(65), "o1043; drop"]) {
    const res = await loadOrderTimelineAction({ orderId: bad });
    assert.equal(res.ok, false, bad);
    assert.equal(res.page, undefined);
  }
});

test("the action normalizes an oversized cursor to the first page", async () => {
  const first = await loadOrderTimelineAction({ orderId: MOCK_ORDER });
  const res = await loadOrderTimelineAction({
    orderId: MOCK_ORDER,
    cursor: "z".repeat(300),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.page?.events.map((e) => e.id),
    first.page?.events.map((e) => e.id),
  );
});

test("the action pages with a real cursor without duplicating a row", async () => {
  const first = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 2 });
  const res = await loadOrderTimelineAction({
    orderId: MOCK_ORDER,
    cursor: first.nextCursor,
  });
  assert.equal(res.ok, true);
  const firstIds = new Set(first.events.map((e) => e.id));
  for (const e of res.page!.events) {
    assert.ok(!firstIds.has(e.id), "the next page never repeats the first");
  }
});

// ══ 6. Timezone — the tenant's zone is the ONLY authority ═════════════════

test("the SAME instant renders differently under UTC vs Asia/Jerusalem", () => {
  const iso = "2026-07-01T23:30:00Z";
  const utc = formatTenantDateTime(iso, "en", "UTC");
  const jlm = formatTenantDateTime(iso, "en", JLM);
  assert.notEqual(utc, jlm);
  // 23:30Z is 02:30 the NEXT day in Jerusalem (+03:00 in July).
  assert.match(utc, /1\/07\/2026|01\/07\/2026|Jul 1|1 Jul/i);
  assert.match(jlm, /2\/07\/2026|02\/07\/2026|Jul 2|2 Jul/i);
});

test("changing LOCALE does not change the timezone interpretation", () => {
  const iso = "2026-07-01T23:30:00Z";
  // Same zone, three locales: the underlying wall clock (02:30) is identical.
  for (const locale of LOCALES) {
    assert.match(formatTenantDateTime(iso, locale, JLM), /02:30|2:30/);
  }
});

test("no rendered timestamp is a raw UTC ISO string", async () => {
  const page = await getOrderTimelinePage({ orderId: MOCK_ORDER, pageSize: 50 });
  for (const e of page.events) {
    const shown = formatTenantDateTime(e.createdAt, "en", JLM);
    assert.doesNotMatch(shown, /T\d{2}:\d{2}:\d{2}/);
    assert.doesNotMatch(shown, /Z$/);
  }
});

// ══ 7. Source-level contract guards ══════════════════════════════════════
// (Behavioural coverage above is primary; these pin invariants a runtime test
//  cannot observe — that a forbidden import/branch does not EXIST at all.)

test("the Supabase order read is entity-scoped, keyset-paginated and bounded", () => {
  const src = stripComments(readSrc("lib/data/supabase-reads.ts"));
  const fn = src.slice(src.indexOf("export async function sbGetOrderTimelinePage"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /\.eq\("entity_type", "order"\)/);
  assert.match(body, /\.eq\("entity_id", input\.orderId\)/);
  assert.match(body, /\.eq\("tenant_id", tenantId\)/);
  assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(body, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(body, /\.limit\(input\.pageSize \+ 1\)/);
  // Actors resolved ONCE for the page (bounded), never per row.
  assert.match(body, /distinctActorIds\(/);
  assert.doesNotMatch(body, /for \(const .* of page\)[\s\S]*rpc\(/);
});

test("the Supabase order read NEVER trusts a client tenant and fails closed", () => {
  const src = stripComments(readSrc("lib/data/supabase-reads.ts"));
  const fn = src.slice(src.indexOf("export async function sbGetOrderTimelinePage"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  // Tenant is server-derived; a tenantless/invalid request returns an empty page.
  assert.match(body, /getReadContext\(\)/);
  assert.match(body, /isTenantless\(tenantId\)[\s\S]*isUuid\(input\.orderId\)/);
  assert.match(body, /return \{ events: \[\], nextCursor: null, hasMore: false \}/);
  assert.doesNotMatch(body, /tenantId\s*=\s*input/);
  assert.doesNotMatch(body, /p_tenant_id:\s*input/);
});

test("the M8H.3 modules never touch service_role or a sensitive column", () => {
  // Whole-file, for the files M8H.3 owns.
  for (const rel of [
    "lib/order-timeline.ts",
    "lib/data/order-timeline.ts",
    "lib/actions/order-timeline.ts",
    "components/admin/order-timeline.tsx",
  ]) {
    const src = readSrc(rel);
    assert.doesNotMatch(src, /service_role/i, rel);
    assert.doesNotMatch(src, /sb_secret_/, rel);
    assert.doesNotMatch(src, /token_hash/, rel);
    assert.doesNotMatch(src, /customer_snapshot/, rel);
  }
  // supabase-reads.ts is a large shared module that legitimately maps
  // customer_snapshot for OTHER features (guest orders), so the guard is scoped
  // to the Order Timeline read itself: it must select only the safe audit
  // columns and touch nothing sensitive.
  const src = stripComments(readSrc("lib/data/supabase-reads.ts"));
  const fn = src.slice(src.indexOf("export async function sbGetOrderTimelinePage"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(
    body,
    /\.select\("id, event_type, actor_user_id, metadata, created_at"\)/,
  );
  for (const forbidden of [
    /service_role/i,
    /sb_secret_/,
    /token_hash/,
    /customer_snapshot/,
    /order_number/,
  ]) {
    assert.doesNotMatch(body, forbidden);
  }
});

test("the Order Timeline read path performs NO write and logs NO audit event", () => {
  for (const rel of [
    "lib/data/order-timeline.ts",
    "lib/actions/order-timeline.ts",
  ]) {
    const src = stripComments(readSrc(rel));
    // No mutation verbs, and above all no audit producer.
    assert.doesNotMatch(src, /_log_order_audit_event/, rel);
    assert.doesNotMatch(src, /_log_customer_audit_event/, rel);
    assert.doesNotMatch(src, /\.insert\(/, rel);
    assert.doesNotMatch(src, /\.update\(/, rel);
    assert.doesNotMatch(src, /\.delete\(/, rel);
    assert.doesNotMatch(src, /revalidatePath|revalidateTag/, rel);
  }
});

test("the client component imports NO server-only module", () => {
  const src = readSrc("components/admin/order-timeline.tsx");
  assert.match(src, /^"use client";/);
  // The action arrives as an injected prop; only its TYPE is imported.
  assert.match(src, /import type \{ OrderTimelineActionResult \}/);
  assert.doesNotMatch(stripComments(src), /from "@\/lib\/data/);
  assert.doesNotMatch(stripComments(src), /from "@\/lib\/mock/);
  assert.doesNotMatch(stripComments(src), /@\/lib\/tenant-day/);
  assert.doesNotMatch(stripComments(src), /@\/lib\/time-catalog/);
  assert.doesNotMatch(stripComments(src), /server-only/);
});

test("the client component formats times ONLY with the tenant zone", () => {
  const src = stripComments(readSrc("components/admin/order-timeline.tsx"));
  assert.match(src, /formatTenantDateTime\(event\.createdAt, locale, timeZone\)/);
  // No device/server clock authority anywhere.
  assert.doesNotMatch(src, /toLocaleString|toLocaleDateString|toLocaleTimeString/);
  assert.doesNotMatch(src, /new Date\(\)/);
  assert.doesNotMatch(src, /Intl\.DateTimeFormat/);
  assert.doesNotMatch(src, /resolvedOptions\(\)/);
});

test("the Order Details page passes the SERVER-derived tenant zone + bounded page", () => {
  const src = stripComments(readSrc("app/[locale]/admin/orders/[id]/page.tsx"));
  assert.match(src, /getTenantTimeZone\(\)/);
  assert.match(src, /getOrderTimelinePage\(\{ orderId: order\.id \}\)/);
  assert.match(src, /<OrderTimeline/);
  assert.match(src, /timeZone=\{timeZone\}/);
  assert.match(src, /loadMore=\{loadOrderTimelineAction\}/);
});

test("the M8H.1 RLS policy scopes ORDER audit rows by can_access_order", () => {
  const sql = readRepo(
    "supabase/migrations/20260802100000_m8h1_order_audit_foundation.sql",
  );
  assert.match(sql, /entity_type <> 'order'/);
  assert.match(sql, /can_access_order\(tenant_id, entity_id\)/);
  // Fails closed on a NULL entity_id (can_access_order is true for owner/admin
  // regardless of the id, so the NOT NULL guard is what closes that hole).
  assert.match(sql, /entity_id is not null and public\.can_access_order/);
  // SELECT-only: the timeline can never write, even by accident.
  assert.match(sql, /for select\s+to authenticated/);
});

test("M8H.3 adds NO migration — the M8G.3 index + M8H.1 policy already serve it", () => {
  const idx = readRepo(
    "supabase/migrations/20260801100000_m8g3_customer_timeline_index.sql",
  );
  // The index is entity-GENERIC (tenant, entity_type, entity_id, ts, id), so an
  // order-scoped read is already an index range scan — no new index is needed.
  assert.match(
    idx,
    /audit_events \(tenant_id, entity_type, entity_id, created_at desc, id desc\)/,
  );
  const migrations = readdirSync(join(process.cwd(), "supabase", "migrations"));
  assert.ok(
    !migrations.some((f) => /m8h3/i.test(f)),
    "M8H.3 must not introduce a migration",
  );
  // Snapshot of the migration count: M8H.2 was the last through M8H; Batch C
  // then adds the C1 dashboard-metrics aggregate RPC and the C2 signup-review
  // concurrency fix (FOR UPDATE lock + terminal-state CHECK).
  assert.equal(migrations.length, 56);
});
