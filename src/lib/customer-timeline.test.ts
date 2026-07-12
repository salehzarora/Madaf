/**
 * Customer Timeline test suite (M8G.3). Exercises the PURE, isomorphic timeline
 * contract — the opaque keyset cursor, deterministic DESC ordering + tie-break,
 * page-size clamping, viewer-aware actor resolution, and the client-safe
 * metadata projection — plus the mock data-layer page (bounded, cursor-paginated,
 * no dup/skip) and source-level guards for the server read / server action / UI /
 * migration contract. Pure + zero-env: runs in mock mode with no Supabase.
 *
 * Runner: `npm run test:customer-timeline` (tsx → node:test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  auditEventLabel,
  renderCustomerAuditDetails,
} from "./audit-events";
import {
  buildTimelineEvent,
  clampTimelinePageSize,
  clientSafeMetadata,
  compareTimelineDesc,
  decodeTimelineCursor,
  encodeTimelineCursor,
  resolveTimelineActor,
  timelineRowBeforeCursor,
  TIMELINE_PAGE_SIZE_DEFAULT,
  TIMELINE_PAGE_SIZE_MAX,
  type TimelineActor,
} from "./customer-timeline";
import { getCustomerTimelinePage } from "./data/customer-timeline";
import { auditActors, auditEvents } from "./mock";
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

const MOCK_CUSTOMER = "c01";
const NAMED = new Map([["u-owner", "owner@madaf.local"]]);
const EMPTY = new Map<string, string>();

// ── 1–4. clampTimelinePageSize: bounded [1,50], default for non-integers ────
test("page size default + max constants are 20 / 50", () => {
  assert.equal(TIMELINE_PAGE_SIZE_DEFAULT, 20);
  assert.equal(TIMELINE_PAGE_SIZE_MAX, 50);
});
test("clampTimelinePageSize clamps into [1,50]", () => {
  assert.equal(clampTimelinePageSize(0), 1);
  assert.equal(clampTimelinePageSize(-5), 1);
  assert.equal(clampTimelinePageSize(1), 1);
  assert.equal(clampTimelinePageSize(50), 50);
  assert.equal(clampTimelinePageSize(51), 50);
  assert.equal(clampTimelinePageSize(1000), 50);
  assert.equal(clampTimelinePageSize(30), 30);
});
test("clampTimelinePageSize: non-integers → the default", () => {
  assert.equal(clampTimelinePageSize(undefined), 20);
  assert.equal(clampTimelinePageSize(null), 20);
  assert.equal(clampTimelinePageSize(NaN), 20);
  assert.equal(clampTimelinePageSize(12.5), 20);
  assert.equal(clampTimelinePageSize("40"), 20);
  assert.equal(clampTimelinePageSize({}), 20);
});
test("clampTimelinePageSize never exceeds the max even for huge input", () => {
  assert.ok(clampTimelinePageSize(Number.MAX_SAFE_INTEGER) <= TIMELINE_PAGE_SIZE_MAX);
});

// ── 5–11. Opaque cursor: encode/decode round-trip + validation ─────────────
test("cursor round-trips (created_at, id)", () => {
  const c = { createdAt: "2026-07-10T09:15:00Z", id: "8" };
  const round = decodeTimelineCursor(encodeTimelineCursor(c));
  assert.deepEqual(round, c);
});
test("cursor is URL-safe (no +, /, or = padding)", () => {
  const enc = encodeTimelineCursor({ createdAt: "2026-07-10T09:15:00.123+00:00", id: "9999" });
  assert.ok(!/[+/=]/.test(enc), `url-safe: ${enc}`);
  assert.deepEqual(decodeTimelineCursor(enc), {
    createdAt: "2026-07-10T09:15:00.123+00:00",
    id: "9999",
  });
});
test("cursor decode: null/empty/oversized → null (never throws)", () => {
  assert.equal(decodeTimelineCursor(null), null);
  assert.equal(decodeTimelineCursor(undefined), null);
  assert.equal(decodeTimelineCursor(""), null);
  assert.equal(decodeTimelineCursor("x".repeat(257)), null);
});
test("cursor decode: garbage / non-base64 → null", () => {
  assert.equal(decodeTimelineCursor("!!!not-base64!!!"), null);
  assert.equal(decodeTimelineCursor("@#$%^&*"), null);
});
test("cursor decode: base64 without a separator → null", () => {
  assert.equal(decodeTimelineCursor(btoa("no-separator-here")), null);
});
test("cursor decode: non-numeric id → null", () => {
  assert.equal(decodeTimelineCursor(btoa("2026-07-10T09:15:00Z|abc")), null);
  assert.equal(decodeTimelineCursor(btoa("2026-07-10T09:15:00Z|1.5")), null);
  assert.equal(decodeTimelineCursor(btoa("2026-07-10T09:15:00Z|-5")), null);
  assert.equal(decodeTimelineCursor(btoa("2026-07-10T09:15:00Z|99999999999999999999")), null);
});
test("cursor decode: invalid timestamp → null", () => {
  assert.equal(decodeTimelineCursor(btoa("not-a-date|8")), null);
  assert.equal(decodeTimelineCursor(btoa("|8")), null);
});

// ── 12–14. Cursor is opaque + carries NO tenant/customer/secret ─────────────
test("cursor payload contains ONLY created_at + id (no tenant/customer/secret)", () => {
  const enc = encodeTimelineCursor({ createdAt: "2026-07-10T09:15:00Z", id: "8" });
  const decoded = atob(enc.replace(/-/g, "+").replace(/_/g, "/"));
  assert.equal(decoded, "2026-07-10T09:15:00Z|8");
  assert.ok(!/tenant|customer|token|c01|uuid/i.test(decoded));
});
test("a cursor from customer A does not authorize — decoding yields only a position", () => {
  // The decoded value is a keyset position, not an identity or grant.
  const c = decodeTimelineCursor(encodeTimelineCursor({ createdAt: "2026-01-01T00:00:00Z", id: "1" }));
  assert.deepEqual(Object.keys(c ?? {}).sort(), ["createdAt", "id"]);
});
test("a tampered id inside a cursor still decodes to a mere position (RLS authorizes)", () => {
  // Even a valid-but-forged position cannot widen access; it only changes WHERE
  // in the (already RLS-scoped) result set the next page starts.
  const forged = encodeTimelineCursor({ createdAt: "2999-01-01T00:00:00Z", id: "9999999999" });
  assert.deepEqual(decodeTimelineCursor(forged), {
    createdAt: "2999-01-01T00:00:00Z",
    id: "9999999999",
  });
});

// ── 15–19. Deterministic DESC ordering + equal-timestamp tie-break ─────────
test("compareTimelineDesc: newest created_at first", () => {
  const rows = [
    { createdAt: "2026-01-01T00:00:00Z", id: "1" },
    { createdAt: "2026-03-01T00:00:00Z", id: "2" },
    { createdAt: "2026-02-01T00:00:00Z", id: "3" },
  ];
  const sorted = [...rows].sort(compareTimelineDesc).map((r) => r.id);
  assert.deepEqual(sorted, ["2", "3", "1"]);
});
test("compareTimelineDesc: equal timestamps tie-break by higher id first", () => {
  const rows = [
    { createdAt: "2026-01-01T00:00:00Z", id: "5" },
    { createdAt: "2026-01-01T00:00:00Z", id: "50" },
    { createdAt: "2026-01-01T00:00:00Z", id: "9" },
  ];
  const sorted = [...rows].sort(compareTimelineDesc).map((r) => r.id);
  // BigInt compare, not lexicographic: 50 > 9 > 5.
  assert.deepEqual(sorted, ["50", "9", "5"]);
});
test("compareTimelineDesc: id tie-break is numeric, not string (10 > 9)", () => {
  const a = { createdAt: "2026-01-01T00:00:00Z", id: "10" };
  const b = { createdAt: "2026-01-01T00:00:00Z", id: "9" };
  assert.ok(compareTimelineDesc(a, b) < 0, "10 sorts before 9 in DESC");
});
test("compareTimelineDesc is a total order (identical rows compare 0)", () => {
  const r = { createdAt: "2026-01-01T00:00:00Z", id: "7" };
  assert.equal(compareTimelineDesc(r, { ...r }), 0);
});
test("mock events are already stored newest-first (id + created_at co-descend)", () => {
  const forC01 = auditEvents.filter((e) => e.customerId === MOCK_CUSTOMER);
  const resorted = [...forC01].sort(compareTimelineDesc);
  assert.deepEqual(forC01.map((e) => e.id), resorted.map((e) => e.id));
});

// ── 20–23. Keyset predicate (row strictly OLDER than the cursor) ───────────
test("timelineRowBeforeCursor: older timestamp is before the cursor", () => {
  const cur = { createdAt: "2026-07-05T00:00:00Z", id: "6" };
  assert.ok(timelineRowBeforeCursor({ createdAt: "2026-07-01T00:00:00Z", id: "3" }, cur));
  assert.ok(!timelineRowBeforeCursor({ createdAt: "2026-07-10T00:00:00Z", id: "9" }, cur));
});
test("timelineRowBeforeCursor: equal timestamp → lower id is before", () => {
  const cur = { createdAt: "2026-07-05T00:00:00Z", id: "6" };
  assert.ok(timelineRowBeforeCursor({ createdAt: "2026-07-05T00:00:00Z", id: "5" }, cur));
  assert.ok(!timelineRowBeforeCursor({ createdAt: "2026-07-05T00:00:00Z", id: "7" }, cur));
});
test("timelineRowBeforeCursor: the cursor row itself is NOT before it (strict)", () => {
  const cur = { createdAt: "2026-07-05T00:00:00Z", id: "6" };
  assert.ok(!timelineRowBeforeCursor({ createdAt: "2026-07-05T00:00:00Z", id: "6" }, cur));
});
test("timelineRowBeforeCursor: id compare is numeric (100 not before 6)", () => {
  const cur = { createdAt: "2026-07-05T00:00:00Z", id: "6" };
  assert.ok(!timelineRowBeforeCursor({ createdAt: "2026-07-05T00:00:00Z", id: "100" }, cur));
});

// ── 24–29. Viewer-aware actor resolution ───────────────────────────────────
test("actor: null actor_user_id → unknown (deleted/unattributable)", () => {
  assert.deepEqual(resolveTimelineActor(null, { isAdmin: true, emails: NAMED }), {
    kind: "unknown",
  });
});
test("actor: owner/admin + roster hit → named (email label)", () => {
  assert.deepEqual(resolveTimelineActor("u-owner", { isAdmin: true, emails: NAMED }), {
    kind: "named",
    label: "owner@madaf.local",
  });
});
test("actor: owner/admin + roster miss → former member", () => {
  assert.deepEqual(resolveTimelineActor("u-admin", { isAdmin: true, emails: NAMED }), {
    kind: "former",
  });
});
test("actor: sales_rep (no roster access) → neutral member, never an email", () => {
  const a = resolveTimelineActor("u-owner", { isAdmin: false, emails: EMPTY });
  assert.deepEqual(a, { kind: "member" });
  assert.ok(!("label" in a));
});
test("actor: a sales_rep NEVER receives an email even if a roster leaked in", () => {
  // Defense: isAdmin=false must never produce a named label.
  const a = resolveTimelineActor("u-owner", { isAdmin: false, emails: NAMED });
  assert.equal(a.kind, "member");
});
test("actor: every kind maps to a non-empty localized label in ar/he/en", () => {
  const kinds: TimelineActor[] = [
    { kind: "named", label: "x@y.z" },
    { kind: "member" },
    { kind: "former" },
    { kind: "unknown" },
  ];
  for (const locale of LOCALES) {
    const t = getDictionary(locale).audit.timeline;
    assert.ok(t.actorMember.length > 0 && t.actorFormer.length > 0 && t.actorUnknown.length > 0);
    assert.ok(t.by.includes("{actor}"), `${locale} 'by' interpolates {actor}`);
  }
  assert.equal(kinds.length, 4);
});

// ── 30–36. clientSafeMetadata: per-type allowlist projection ────────────────
test("clientSafeMetadata: created keeps origin + customer_type only", () => {
  const out = clientSafeMetadata("customer.created", {
    origin: "manual",
    customer_type: "grocery",
    signup_request_id: "r1",
    source_order_id: "o1",
  });
  assert.deepEqual(Object.keys(out).sort(), ["customer_type", "origin"]);
  assert.equal(out.origin, "manual");
});
test("clientSafeMetadata: updated keeps changed_fields + customer_type only", () => {
  const out = clientSafeMetadata("customer.updated", {
    changed_fields: ["name", "phone", "customer_type"],
    customer_type: { from: "grocery", to: "kiosk" },
    phone: "050-1234567",
    name: "Secret Shop",
  });
  assert.deepEqual(Object.keys(out).sort(), ["changed_fields", "customer_type"]);
  assert.deepEqual(out.customer_type, { from: "grocery", to: "kiosk" });
});
test("clientSafeMetadata: changed_fields is filtered to the known field allowlist", () => {
  const out = clientSafeMetadata("customer.updated", {
    changed_fields: ["name", "not_a_field", "phone", "password", "customer_type"],
  });
  assert.deepEqual(out.changed_fields, ["name", "phone", "customer_type"]);
});
test("clientSafeMetadata: access-link created/rotated keep expires_at; revoked keeps nothing", () => {
  assert.deepEqual(
    clientSafeMetadata("customer.access_link.created", { link_id: "l1", expires_at: "2026-12-31" }),
    { expires_at: "2026-12-31" },
  );
  assert.deepEqual(
    clientSafeMetadata("customer.access_link.rotated", { link_id: "l2", expires_at: "2026-12-31" }),
    { expires_at: "2026-12-31" },
  );
  assert.deepEqual(clientSafeMetadata("customer.access_link.revoked", { link_id: "l3" }), {});
});
test("clientSafeMetadata: activated/deactivated/order_linked project to {}", () => {
  assert.deepEqual(clientSafeMetadata("customer.activated", { before_active: false, after_active: true }), {});
  assert.deepEqual(clientSafeMetadata("customer.deactivated", { before_active: true, after_active: false }), {});
  assert.deepEqual(clientSafeMetadata("customer.order_linked", { order_id: "o1", previous_linkage: "unlinked" }), {});
});
test("clientSafeMetadata: an UNKNOWN event type projects to {} (nothing raw)", () => {
  assert.deepEqual(clientSafeMetadata("customer.bogus", { anything: "here" }), {});
  assert.deepEqual(clientSafeMetadata("order.created", { total: 999 }), {});
});
test("clientSafeMetadata: link ids / order ids / request ids NEVER survive", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["customer.access_link.created", { link_id: "l1", expires_at: "2026-12-31" }],
    ["customer.access_link.rotated", { link_id: "l2", expires_at: "2026-12-31" }],
    ["customer.order_linked", { order_id: "o1", source_order_id: "o2" }],
    ["customer.created", { origin: "signup", signup_request_id: "r1", source_order_id: "o1" }],
  ];
  for (const [type, meta] of cases) {
    const out = clientSafeMetadata(type, meta);
    const json = JSON.stringify(out);
    assert.ok(!/link_id|order_id|source_order_id|signup_request_id/.test(json), `${type} leaks an id`);
  }
});

// ── 37–40. clientSafeMetadata: PII / token / hash / URL never survive ──────
test("clientSafeMetadata: an (impossible) PII/token/URL value is dropped", () => {
  const out = clientSafeMetadata("customer.access_link.rotated", {
    expires_at: "2026-12-31",
    token: "SECRET-TOKEN",
    token_hash: "DEADBEEFHASH",
    url: "https://madaf-drab.vercel.app/shop/SECRET",
    phone: "050-1234567",
  });
  const json = JSON.stringify(out);
  assert.ok(!/SECRET|DEADBEEF|http|050-/i.test(json));
  assert.deepEqual(out, { expires_at: "2026-12-31" });
});
test("clientSafeMetadata: customer_type only accepts a string or {from,to} strings", () => {
  assert.deepEqual(clientSafeMetadata("customer.created", { customer_type: "kiosk", origin: "manual" }).customer_type, "kiosk");
  // A malformed customer_type object is dropped, not passed through.
  const bad = clientSafeMetadata("customer.updated", { changed_fields: ["customer_type"], customer_type: { from: 1, to: 2 } });
  assert.ok(!("customer_type" in bad) || bad.customer_type === undefined);
});
test("clientSafeMetadata: null/undefined metadata → {}", () => {
  assert.deepEqual(clientSafeMetadata("customer.created", null), {});
  assert.deepEqual(clientSafeMetadata("customer.created", undefined), {});
});
test("clientSafeMetadata: an unexpected/future key is never forwarded", () => {
  const out = clientSafeMetadata("customer.created", { origin: "manual", future_secret_field: "leak" });
  assert.ok(!("future_secret_field" in out));
});

// ── 41–44. buildTimelineEvent: safe shape ──────────────────────────────────
test("buildTimelineEvent: shape carries id/type/createdAt/actor/sensitivity/category", () => {
  const ev = buildTimelineEvent({
    id: "8",
    eventType: "customer.created",
    createdAt: "2026-06-15T09:00:00Z",
    actor: { kind: "named", label: "owner@madaf.local" },
    metadata: { origin: "manual", customer_type: "grocery" },
  });
  assert.equal(ev.id, "8");
  assert.equal(ev.category, "customer");
  assert.ok(["low", "medium", "high"].includes(ev.sensitivity));
  assert.deepEqual(Object.keys(ev.metadata).sort(), ["customer_type", "origin"]);
});
test("buildTimelineEvent: metadata is ALWAYS client-safe-projected", () => {
  const ev = buildTimelineEvent({
    id: "1",
    eventType: "customer.order_linked",
    createdAt: "2026-07-10T09:15:00Z",
    actor: { kind: "unknown" },
    metadata: { order_id: "o1", source_order_id: "o2" },
  });
  assert.deepEqual(ev.metadata, {});
});
test("buildTimelineEvent: an unknown event type still yields a safe (empty-metadata) row", () => {
  const ev = buildTimelineEvent({
    id: "9",
    eventType: "customer.mystery",
    createdAt: "2026-07-10T09:15:00Z",
    actor: { kind: "member" },
    metadata: { anything: "x" },
  });
  assert.deepEqual(ev.metadata, {});
  assert.equal(ev.category, "customer");
});
test("buildTimelineEvent: null metadata is tolerated", () => {
  const ev = buildTimelineEvent({
    id: "2",
    eventType: "customer.activated",
    createdAt: "2026-07-03T10:00:00Z",
    actor: { kind: "unknown" },
    metadata: null,
  });
  assert.deepEqual(ev.metadata, {});
});

// ── 45–52. Mock data layer: bounded, ordered, cursor-paginated ─────────────
test("mock page: returns events for the target customer, newest first", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER });
  assert.ok(page.events.length > 0);
  for (let i = 1; i < page.events.length; i++) {
    assert.ok(compareTimelineDesc(page.events[i - 1], page.events[i]) <= 0, "monotonic DESC");
  }
  assert.equal(page.events[0].eventType, "customer.order_linked"); // id 8, newest
});
test("mock page: an unknown customer → honest empty page", async () => {
  const page = await getCustomerTimelinePage({ customerId: "does-not-exist" });
  assert.deepEqual(page, { events: [], nextCursor: null, hasMore: false });
});
test("mock page: pageSize bounds the returned rows + drives hasMore", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 3 });
  assert.equal(page.events.length, 3);
  assert.equal(page.hasMore, true);
  assert.ok(page.nextCursor);
});
test("mock page: last page has hasMore=false + nextCursor=null", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});
test("mock pagination: two pages have NO overlap and NO skip", async () => {
  const p1 = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 3 });
  const p2 = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 3, cursor: p1.nextCursor });
  const ids1 = p1.events.map((e) => e.id);
  const ids2 = p2.events.map((e) => e.id);
  assert.equal(new Set([...ids1, ...ids2]).size, ids1.length + ids2.length, "no overlap");
  // No skip: page 2 continues immediately after page 1 in the full DESC order.
  const all = auditEvents
    .filter((e) => e.customerId === MOCK_CUSTOMER)
    .sort(compareTimelineDesc)
    .map((e) => e.id);
  assert.deepEqual([...ids1, ...ids2], all.slice(0, ids1.length + ids2.length));
});
test("mock pagination: walking every page reconstructs the full history exactly once", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page: Awaited<ReturnType<typeof getCustomerTimelinePage>> =
      await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 2, cursor });
    seen.push(...page.events.map((e) => e.id));
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const all = auditEvents
    .filter((e) => e.customerId === MOCK_CUSTOMER)
    .sort(compareTimelineDesc)
    .map((e) => e.id);
  assert.deepEqual(seen, all);
  assert.equal(new Set(seen).size, seen.length, "each event exactly once");
});
test("mock page: a malformed cursor is ignored → first page (never throws/leaks)", async () => {
  const first = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 3 });
  const garbage = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 3, cursor: "!!!bad!!!" });
  assert.deepEqual(garbage.events.map((e) => e.id), first.events.map((e) => e.id));
});
test("mock page: pageSize is clamped (huge request never returns > max)", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 9999 });
  assert.ok(page.events.length <= TIMELINE_PAGE_SIZE_MAX);
});

// ── 53–55. Mock actor resolution (open demo = owner/admin viewer) ──────────
test("mock page: a rostered actor resolves to a named email label", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  const created = page.events.find((e) => e.eventType === "customer.created");
  assert.equal(created?.actor.kind, "named");
  assert.equal(auditActors.get("u-owner"), "owner@madaf.local");
});
test("mock page: an off-roster actor (u-admin) → former member", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  const linked = page.events.find((e) => e.eventType === "customer.order_linked"); // actor u-admin
  assert.equal(linked?.actor.kind, "former");
});
test("mock page: a null actor → unknown", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  const deactivated = page.events.find((e) => e.eventType === "customer.deactivated"); // actorUserId null
  assert.equal(deactivated?.actor.kind, "unknown");
});

// ── 56–58. Rendering: labels + details are safe + localized (never raw PII) ─
test("rendering: every mock event has a non-empty label in ar/he/en; none is 'Other'", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  for (const locale of LOCALES) {
    const dict = getDictionary(locale);
    for (const e of page.events) {
      const label = auditEventLabel(e.eventType, dict);
      assert.ok(label.length > 0, `${locale} ${e.eventType}`);
      assert.ok(!/^other$/i.test(label));
    }
  }
});
test("rendering: details for a page never surface a token/hash/URL/phone", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  const dict = getDictionary("en");
  for (const e of page.events) {
    const joined = renderCustomerAuditDetails(e, dict).join(" | ");
    assert.ok(!/token|hash|http|:\/\/|050-|@madaf/i.test(joined), `${e.eventType}: ${joined}`);
  }
});
test("rendering: an updated event lists localized changed-field labels", async () => {
  const page = await getCustomerTimelinePage({ customerId: MOCK_CUSTOMER, pageSize: 50 });
  const updated = page.events.find(
    (e) => e.eventType === "customer.updated" && Array.isArray(e.metadata.changed_fields),
  );
  assert.ok(updated);
  const dict = getDictionary("he");
  const lines = renderCustomerAuditDetails(updated!, dict);
  assert.ok(lines.length > 0);
});

// ── 59. i18n parity: the timeline block exists + is non-empty in all 3 ──────
test("i18n: audit.timeline exists + every string is non-empty in ar/he/en", () => {
  for (const locale of LOCALES) {
    const t = getDictionary(locale).audit.timeline;
    for (const [k, v] of Object.entries(t)) {
      assert.equal(typeof v, "string", `${locale} ${k}`);
      assert.ok((v as string).length > 0, `${locale} ${k} non-empty`);
    }
  }
});

// ── 60–64. Source guards: server read is bounded, scoped, no-leak, no-N+1 ───
const READS = readSrc("lib/data/supabase-reads.ts");
test("guard: the server read selects NO token/hash/url/entity columns", () => {
  const sel = READS.match(/\.select\("id, event_type, actor_user_id, metadata, created_at"\)/);
  assert.ok(sel, "explicit safe column list");
  // The select list must never widen to token/hash/url.
  const block = READS.slice(READS.indexOf("sbGetCustomerTimelinePage"));
  assert.ok(!/token|hash|\burl\b/i.test(block.slice(0, block.indexOf("return"))), "no secret columns read");
});
test("guard: server read fixes entity_type + server-derives tenant (no client trust)", () => {
  const block = READS.slice(READS.indexOf("sbGetCustomerTimelinePage"), READS.indexOf("sbListCustomers"));
  assert.ok(/\.eq\("entity_type", "customer"\)/.test(block), "entity_type is a fixed literal");
  assert.ok(/\.eq\("tenant_id", tenantId\)/.test(block), "tenant from getReadContext");
  assert.ok(/getReadContext\(\)/.test(block), "tenant is server-derived");
  assert.ok(!/p_tenant|input\.tenant/.test(block), "no client tenant param");
});
test("guard: server read is BOUNDED (limit pageSize+1) + ordered DESC,DESC", () => {
  const block = READS.slice(READS.indexOf("sbGetCustomerTimelinePage"), READS.indexOf("sbListCustomers"));
  assert.ok(/\.limit\(input\.pageSize \+ 1\)/.test(block), "pageSize+1 bound");
  assert.ok(/\.order\("created_at", \{ ascending: false \}\)/.test(block), "created_at DESC");
  assert.ok(/\.order\("id", \{ ascending: false \}\)/.test(block), "id DESC tie-break");
});
test("guard: server read resolves actors in ONE roster lookup (no N+1)", () => {
  const block = READS.slice(READS.indexOf("sbGetCustomerTimelinePage"), READS.indexOf("sbListCustomers"));
  const calls = (block.match(/listTenantMembers\(\)/g) ?? []).length;
  assert.equal(calls, 1, "exactly one roster lookup per page");
  // And only for owner/admin (guards the existing roster-visibility boundary).
  assert.ok(/isAdmin && page\.some/.test(block), "roster only when owner/admin + has actors");
});
test("guard: server read uses the row-value keyset predicate (not id-only)", () => {
  const block = READS.slice(READS.indexOf("sbGetCustomerTimelinePage"), READS.indexOf("sbListCustomers"));
  assert.ok(
    /created_at\.lt\.\$\{cursor\.createdAt\},and\(created_at\.eq\.\$\{cursor\.createdAt\},id\.lt\.\$\{cursor\.id\}\)/.test(block),
    "row-value keyset (created_at, id) < cursor",
  );
});

// ── 65–67. Source guards: the server action is read-only + validates input ──
test("guard: the load-more action is read-only (logs nothing, no audit/insert)", () => {
  const action = stripComments(readSrc("lib/actions/customer-timeline.ts"));
  assert.ok(!/_log_customer|\.insert\(|\.rpc\(|audit_events/i.test(action), "no mutation / no audit write");
  assert.ok(/getCustomerTimelinePage/.test(action), "delegates to the bounded read");
});
test("guard: the action validates customerId + bounds the cursor length", () => {
  const action = readSrc("lib/actions/customer-timeline.ts");
  assert.ok(/isPlausibleId/.test(action), "customerId is validated");
  assert.ok(/MAX_CURSOR_LENGTH/.test(action) && /256/.test(action), "cursor length is bounded");
  assert.ok(!/p_tenant|tenantId|role/.test(action), "no client tenant/role is accepted");
});
test("guard: the action never trusts a client page size or event filter", () => {
  const action = stripComments(readSrc("lib/actions/customer-timeline.ts"));
  assert.ok(!/pageSize|eventType|entity_type/.test(action), "no client page-size/filter surface");
});

// ── 68–70. Source guards: the pure module + UI stay safe ───────────────────
test("guard: the pure timeline module imports no server/data layer (isomorphic)", () => {
  const src = readSrc("lib/customer-timeline.ts");
  // Whole-file import scan (imports may span lines): forbid server-only paths.
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(
    !imports.some((p) => /(supabase-reads|supabase-writes|server-only|^next\/|\/data\/)/.test(p)),
    `no server-only / data-layer / next import: ${imports.join(", ")}`,
  );
  // Isomorphic base64 (no Buffer in CODE), so it runs on the client too.
  assert.ok(!/\bBuffer\b/.test(stripComments(src)), "no Buffer (uses btoa/atob)");
});
test("guard: the UI conveys meaning by TEXT, not icon/color alone (a11y)", () => {
  const ui = readSrc("components/admin/customer-timeline.tsx");
  assert.ok(/aria-hidden/.test(ui), "decorative icons are aria-hidden");
  assert.ok(/auditEventLabel/.test(ui), "each row renders a text label");
  assert.ok(/role="alert"/.test(ui), "load errors are announced");
  // No raw metadata object is dumped into the DOM.
  assert.ok(!/JSON\.stringify|event\.metadata\}/.test(ui), "no raw metadata rendered");
  // A named actor is an email → bidi-isolated (dir="ltr") so RTL sentences don't
  // reorder the "@"/"." (matches the team-roster convention).
  assert.ok(/dir="ltr"/.test(ui), "named (email) actors are bidi-isolated");
});
test("guard: no GLOBAL activity-log route was added (per-customer timeline only)", () => {
  for (const p of ["app/[locale]/admin/activity", "app/[locale]/admin/audit", "components/admin/activity-log.tsx"]) {
    assert.ok(!existsSync(join(process.cwd(), "src", p)), `${p} must not exist`);
  }
});

// ── 71. Guard: the index migration is additive-only (no policy/grant change) ─
test("guard: the M8G.3 migration is an additive index only (no policy/grant/data)", () => {
  const mig = readRepo("supabase/migrations/20260801100000_m8g3_customer_timeline_index.sql");
  assert.ok(/create index/i.test(mig), "creates an index");
  assert.ok(/audit_events \(tenant_id, entity_type, entity_id, created_at desc, id desc\)/i.test(mig));
  assert.ok(!/drop policy|create policy|alter policy|grant |revoke |insert into|update |delete from/i.test(mig), "no policy/grant/data change");
});
