/**
 * M8H.3 — MOUNTED OrderTimeline INTEGRATION TESTS.
 *
 * These mount the REAL component (no copy, no re-implementation), with the
 * "load more" Server Action supplied through the production injection seam and
 * resolved BY HAND — so intermediate renders (the pending state, a stale reply,
 * an overlapping click) are actually observable rather than assumed.
 *
 * What they pin, behaviourally:
 *   • rows render the real M8H.1 events with their localized labels;
 *   • an UNRECOGNIZED event (the legacy `order.delivered` seed row) renders the
 *     explicit unknown label and NEVER its raw metadata;
 *   • the before → after status pair is two localized chips + an accessible
 *     sentence — meaning is never carried by the arrow glyph alone;
 *   • timestamps render in the TENANT's zone, not the device's or the server's;
 *   • actor fallbacks (named / former / team-member / unknown) are localized and
 *     never a raw user id;
 *   • Load more appends without duplicating, an overlapping click cannot fire a
 *     second request, a failure KEEPS the rows and offers Retry, and Retry works;
 *   • the empty state is calm, not an error;
 *   • ar/he render RTL-safely and en LTR.
 *
 * Runner: `npm run test:order-timeline-ui` (plain tsx — NOT
 * --conditions=react-server, which would resolve React to its server build and
 * give us no hooks).
 */
// FIRST: the DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { OrderTimeline } from "@/components/admin/order-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { OrderTimelineActionResult } from "@/lib/actions/order-timeline";
import { buildOrderTimelineEvent, type OrderTimelinePage } from "@/lib/order-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import { formatTenantDateTime } from "@/lib/time";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
/** 23:30Z is 02:30 the NEXT DAY in Jerusalem (+03 in July) — so a timezone bug
 * cannot hide behind an hour-only difference; the DATE moves too. */
const INSTANT = "2026-07-01T23:30:00Z";
const ORDER = "o1043";

// ── Fixtures ──────────────────────────────────────────────────────────────
const OWNER: TimelineActor = { kind: "named", label: "owner@madaf.local" };
const FORMER: TimelineActor = { kind: "former" };
const MEMBER: TimelineActor = { kind: "member" };
const UNKNOWN: TimelineActor = { kind: "unknown" };

function event(
  id: string,
  eventType: string,
  metadata: Record<string, unknown>,
  actor: TimelineActor = OWNER,
  createdAt = INSTANT,
) {
  return buildOrderTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const CREATED = event("1", "order.created", {
  source: "sales_visit",
  initiator_kind: "authenticated_user",
  initial_status: "new",
  customer_kind: "existing",
  item_count: 5,
});
const STATUS = event(
  "2",
  "order.status_changed",
  { from_status: "new", to_status: "confirmed", inventory_effect: "reserved" },
  FORMER,
);
const UPDATED = event(
  "3",
  "order.updated",
  { changed_fields: ["items", "notes"], item_count_before: 4, item_count_after: 5 },
  UNKNOWN,
);
const LINKED = event("4", "order.customer_linked", {
  link_kind: "guest_conversion",
});
/** The REAL legacy row from supabase/seed.sql: outside the closed catalog and
 * carrying `order_number`, a key no current producer may write. */
const LEGACY = event("5", "order.delivered", { order_number: "MDF-1043" });

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): OrderTimelinePage => ({
  events,
  nextCursor,
  hasMore: nextCursor !== null,
});

/** A promise whose resolution the test controls — so intermediate renders exist. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  container: HTMLElement;
  /** Every load-more request the component made, in order. */
  requests: { orderId: string; cursor?: string | null }[];
  /** Resolve the Nth request (0-based). */
  answer: (i: number, r: OrderTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial: OrderTimelinePage;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { orderId: string; cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<OrderTimelineActionResult>>[] = [];

  const loadMore = (input: { orderId: string; cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<OrderTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(OrderTimeline, {
        orderId: ORDER,
        locale,
        dict: getDictionary(locale),
        initialPage: opts.initial,
        timeZone: opts.timeZone ?? JLM,
        loadMore,
      }),
    );
  });

  const h: Harness = {
    container: container as unknown as HTMLElement,
    requests,
    async answer(i, r) {
      await act(async () => {
        deferreds[i].resolve(r);
        await deferreds[i].promise;
      });
    },
    async teardown() {
      // An in-flight useTransition left dangling on an unmounted root keeps
      // React's act queue busy and corrupts the NEXT test.
      await act(async () => {
        for (const d of deferreds) d.resolve({ ok: false });
      });
      act(() => root.unmount());
      container.remove();
    },
  };
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  for (const h of harnesses) await h.teardown();
  harnesses = [];
});

// ── DOM queries ───────────────────────────────────────────────────────────
const $ = (h: Harness, sel: string) => h.container.querySelector(sel);
const $$ = (h: Harness, sel: string) => [...h.container.querySelectorAll(sel)];
const text = (h: Harness) => h.container.textContent ?? "";
const rows = (h: Harness) => $$(h, "ol > li");
const button = (h: Harness, label: string) =>
  $$(h, "button").find((b) => (b.textContent ?? "").includes(label)) as
    | HTMLButtonElement
    | undefined;

function click(el: Element) {
  act(() => {
    (el as HTMLButtonElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
}

/** Fire N clicks in ONE synchronous, UN-acted turn — so React has not committed
 * the `disabled` / pending re-render between them. This is the only way to
 * isolate the in-flight REF guard: with an `act()`-wrapped click the disabled
 * attribute would silently be what stops the second request, and the test would
 * pass even with the ref guard deleted. */
function clickBurst(el: Element, times: number) {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    for (let i = 0; i < times; i += 1) {
      (el as HTMLButtonElement).dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    }
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

const EN = getDictionary("en");
const loadMoreButton = (h: Harness) => button(h, EN.audit.timeline.loadMore);
const retryButton = (h: Harness) => button(h, EN.audit.timeline.retry);

describe("OrderTimeline — rendering the real M8H.1 events", () => {
  it("renders one semantic list item per event, newest-first as given", () => {
    const h = mount({ initial: page([CREATED, STATUS, UPDATED, LINKED]) });
    assert.equal(rows(h).length, 4);
    // A semantic ordered list — not a pile of divs.
    assert.ok($(h, "ol"));
  });

  it("shows the localized title for every event type", () => {
    const h = mount({ initial: page([CREATED, STATUS, UPDATED, LINKED]) });
    const body = text(h);
    assert.ok(body.includes(EN.audit.order.events["order.created"]));
    assert.ok(body.includes(EN.audit.order.events["order.status_changed"]));
    assert.ok(body.includes(EN.audit.order.events["order.updated"]));
    assert.ok(body.includes(EN.audit.order.events["order.customer_linked"]));
  });

  it("renders order.created with its honest channel and line count", () => {
    const guest = event("9", "order.created", {
      initiator_kind: "showcase_guest",
      item_count: 6,
    }, UNKNOWN);
    const h = mount({ initial: page([guest]) });
    const body = text(h);
    assert.ok(body.includes(EN.audit.order.initiator.showcase_guest));
    assert.ok(body.includes("6"));
    // A null actor is never silently relabelled "System".
    assert.doesNotMatch(body, /system/i);
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });

  it("renders order.updated as a safe SUMMARY — field names, never values", () => {
    const h = mount({ initial: page([UPDATED]) });
    const body = text(h);
    assert.ok(body.includes(EN.audit.order.fields.items));
    assert.ok(body.includes(EN.audit.order.fields.notes));
    assert.ok(body.includes("4"));
    assert.ok(body.includes("5"));
    // The notes TEXT is never stored, so it can never appear.
    assert.doesNotMatch(body, /private note/i);
  });

  it("renders order.customer_linked distinctly for a guest conversion", () => {
    const h = mount({ initial: page([LINKED]) });
    assert.ok(text(h).includes(EN.audit.order.details.linkedGuestConversion));
  });
});

describe("OrderTimeline — before → after status", () => {
  it("renders the transition as TWO localized chips, not raw enums", () => {
    const h = mount({ initial: page([STATUS]) });
    const body = text(h);
    assert.ok(body.includes(EN.status.new));
    assert.ok(body.includes(EN.status.confirmed));
    // The raw enum values never surface as UI text.
    assert.doesNotMatch(body, /from_status|to_status|inventory_effect/);
  });

  it("carries an ACCESSIBLE before → after sentence (not arrow-only meaning)", () => {
    const h = mount({ initial: page([STATUS]) });
    const sr = $(h, ".sr-only");
    assert.ok(sr, "a screen-reader sentence exists");
    const srText = sr.textContent ?? "";
    assert.ok(srText.includes(EN.status.new));
    assert.ok(srText.includes(EN.status.confirmed));

    // The chip group carrying BOTH status labels must itself be hidden from
    // assistive tech — otherwise the transition is announced twice, the second
    // time as a meaningless "New Confirmed" with the arrow lost.
    const chipGroup = $$(h, '[aria-hidden="true"]').find(
      (el) =>
        (el.textContent ?? "").includes(EN.status.new) &&
        (el.textContent ?? "").includes(EN.status.confirmed),
    );
    assert.ok(chipGroup, "the visual chip pair is aria-hidden");
    // …and the arrow glyph inside it is decorative, never the sole carrier.
    assert.ok(chipGroup.querySelector("svg"));
  });

  it("shows the safe stock effect but NOT exact quantities", () => {
    const h = mount({ initial: page([STATUS]) });
    const body = text(h);
    assert.ok(body.includes(EN.audit.order.inventoryEffect.reserved));
    assert.doesNotMatch(body, /quantity|qty|-\d+ units/i);
  });

  it("a status row with a BOGUS status renders no chips and no raw value", () => {
    const bogus = event("7", "order.status_changed", {
      from_status: "new",
      to_status: "<script>",
    });
    const h = mount({ initial: page([bogus]) });
    const body = text(h);
    assert.doesNotMatch(body, /<script>|script/i);
    // The row still renders its title — it degrades, it does not crash.
    assert.ok(body.includes(EN.audit.order.events["order.status_changed"]));
    assert.equal(rows(h).length, 1);
  });
});

describe("OrderTimeline — unknown event (the real legacy seed row)", () => {
  it("labels it explicitly as unrecognized, never 'Other'", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = text(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
  });

  it("NEVER renders its raw metadata (no JSON, no order number in the DOM)", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = text(h);
    assert.doesNotMatch(body, /MDF-1043/);
    assert.doesNotMatch(body, /order_number/);
    assert.doesNotMatch(body, /\{|\}/); // no JSON dumped anywhere
  });

  it("the event handed to the client carries NO raw metadata at all", () => {
    // The DOM check above cannot see a WIRE leak: an unknown event renders no
    // detail line either way, so a broken projection would still produce a clean
    // DOM while shipping `order_number` inside the RSC/action payload. This
    // asserts the production-built event object itself — the thing that actually
    // crosses the boundary — is empty.
    assert.deepEqual(LEGACY.metadata, {});
    assert.ok(!JSON.stringify(LEGACY).includes("MDF-1043"));
    // …and the same for a KNOWN event that was written with extra stored keys.
    assert.ok(!("source" in CREATED.metadata));
    assert.ok(!("initial_status" in CREATED.metadata));
  });

  it("does not crash the rest of the timeline", () => {
    const h = mount({ initial: page([LEGACY, CREATED, STATUS]) });
    assert.equal(rows(h).length, 3);
    assert.ok(text(h).includes(EN.audit.order.events["order.created"]));
  });
});

describe("OrderTimeline — tenant timezone is the only authority", () => {
  it("renders the timestamp in the TENANT's zone", () => {
    const h = mount({ initial: page([CREATED]), timeZone: JLM });
    assert.ok(text(h).includes(formatTenantDateTime(INSTANT, "en", JLM)));
  });

  it("the SAME instant renders differently under UTC — including the DATE", () => {
    const a = mount({ initial: page([CREATED]), timeZone: JLM });
    const b = mount({ initial: page([CREATED]), timeZone: UTC });
    const inJlm = text(a);
    const inUtc = text(b);
    assert.notEqual(inJlm, inUtc);
    assert.ok(inJlm.includes(formatTenantDateTime(INSTANT, "en", JLM)));
    assert.ok(inUtc.includes(formatTenantDateTime(INSTANT, "en", UTC)));
    // 23:30Z → 02:30 on 2 July in Jerusalem, 23:30 on 1 July in UTC.
    assert.match(inJlm, /02:30|2:30/);
    assert.match(inUtc, /23:30/);
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([CREATED, STATUS, UPDATED, LINKED, LEGACY]) });
    const body = text(h);
    assert.doesNotMatch(body, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.doesNotMatch(body, /\dZ\b/);
  });

  it("changing LOCALE does not change the timezone interpretation", () => {
    for (const locale of ["ar", "he", "en"] as const) {
      const h = mount({ initial: page([CREATED]), locale, timeZone: JLM });
      // Same zone → same wall clock (02:30), whatever the language.
      assert.match(text(h), /02:30|2:30/, locale);
    }
  });
});

describe("OrderTimeline — actor display", () => {
  it("shows a named actor bidi-isolated, never a raw user id", () => {
    const h = mount({ initial: page([CREATED]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"), "email is dir=ltr isolated");
    assert.doesNotMatch(text(h), /\bu-owner\b|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("falls back to a localized label for former / member / unknown actors", () => {
    const h = mount({
      initial: page([
        event("1", "order.created", { item_count: 1 }, FORMER),
        event("2", "order.created", { item_count: 1 }, MEMBER),
        event("3", "order.created", { item_count: 1 }, UNKNOWN),
      ]),
    });
    const body = text(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorMember));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });

  it("a sales_rep's neutral 'team member' label exposes no identity", () => {
    const h = mount({
      initial: page([event("1", "order.created", { item_count: 1 }, MEMBER)]),
    });
    assert.doesNotMatch(text(h), /@/); // no email anywhere
  });
});

describe("OrderTimeline — pagination", () => {
  it("shows Load more only when there IS more", () => {
    const none = mount({ initial: page([CREATED]) });
    assert.equal(loadMoreButton(none), undefined);
    const more = mount({ initial: page([CREATED], "cur-1") });
    assert.ok(loadMoreButton(more));
  });

  it("sends the opaque cursor and APPENDS the older page", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { orderId: ORDER, cursor: "cur-1" });

    await h.answer(0, { ok: true, page: page([STATUS, UPDATED]) });
    assert.equal(rows(h).length, 3);
    // Appended AFTER the initial page (older last) — order is preserved.
    assert.ok(
      text(h).indexOf(EN.audit.order.events["order.created"]) <
        text(h).indexOf(EN.audit.order.events["order.updated"]),
    );
    // No more pages → the button is gone.
    assert.equal(loadMoreButton(h), undefined);
  });

  it("DEDUPES by audit id — a repeated row can never render twice", async () => {
    const h = mount({ initial: page([CREATED, STATUS], "cur-1") });
    click(loadMoreButton(h)!);
    // A (hypothetical) overlapping reply that repeats a row already rendered.
    await h.answer(0, { ok: true, page: page([STATUS, UPDATED]) });
    assert.equal(rows(h).length, 3, "STATUS is not duplicated");
    const ids = rows(h).length;
    assert.equal(ids, new Set([CREATED.id, STATUS.id, UPDATED.id]).size);
  });

  it("a click while loading cannot fire a second request (button is disabled)", () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    const btn = loadMoreButton(h)!;
    click(btn);
    click(btn);
    click(btn);
    assert.equal(h.requests.length, 1);
  });

  it("an UN-ACTED click burst cannot fire a second request (the ref guard)", () => {
    // Three clicks in one synchronous turn, before React can commit `disabled`.
    // Only the in-flight ref can prevent the 2nd and 3rd from paging again —
    // which would append the SAME cursor's page twice.
    const h = mount({ initial: page([CREATED], "cur-1") });
    clickBurst(loadMoreButton(h)!, 3);
    assert.equal(h.requests.length, 1, "the in-flight ref guard holds");
  });

  it("disables the button and marks it busy while loading", () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    const btn = loadMoreButton(h) ?? button(h, EN.audit.timeline.loading);
    assert.ok(btn);
    assert.equal(btn.disabled, true);
    assert.equal(btn.getAttribute("aria-busy"), "true");
    assert.ok(text(h).includes(EN.audit.timeline.loading));
  });
});

describe("OrderTimeline — error, retry, empty", () => {
  it("a failed load KEEPS the rendered events and does not blank the card", async () => {
    const h = mount({ initial: page([CREATED, STATUS], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });

    assert.equal(rows(h).length, 2, "the Order's history is still on screen");
    assert.ok(text(h).includes(EN.audit.timeline.loadError));
  });

  it("announces the failure as an ALERT and never leaks raw backend text", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });

    const alert = $(h, '[role="alert"]');
    assert.ok(alert, "error uses alert semantics, not color alone");
    assert.ok((alert.textContent ?? "").includes(EN.audit.timeline.loadError));
    // The action only ever returns { ok: false } — no message crosses the wire.
    assert.doesNotMatch(text(h), /error:|stack|supabase|PGRST|column .* does not exist/i);
  });

  it("Retry re-issues the SAME cursor and recovers", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });

    const retry = retryButton(h);
    assert.ok(retry, "a retry control is offered");
    click(retry);
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1], { orderId: ORDER, cursor: "cur-1" });

    await h.answer(1, { ok: true, page: page([STATUS]) });
    assert.equal(rows(h).length, 2);
    assert.ok(!text(h).includes(EN.audit.timeline.loadError), "error cleared");
  });

  it("a TRANSPORT REJECTION is handled like a failure — rows kept, guard released", async () => {
    // The injected action normally resolves { ok:false } for an application
    // error, but a Server-Action call can REJECT at the transport layer (network
    // drop, RSC failure before the action's own try/catch runs). The component
    // must treat that identically: keep the rows, show Retry, and — critically —
    // release the in-flight guard so the operator is not stuck with a dead
    // button. This drives a rejecting loadMore directly (not the deferred seam).
    const container = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(container);
    let calls = 0;
    let rejectFirst!: (e: unknown) => void;
    const loadMore = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<OrderTimelineActionResult>((_res, rej) => {
          rejectFirst = rej;
        });
      }
      return Promise.resolve<OrderTimelineActionResult>({
        ok: true,
        page: page([STATUS]),
      });
    };
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(OrderTimeline, {
          orderId: ORDER,
          locale: "en",
          dict: EN,
          initialPage: page([CREATED], "cur-1"),
          timeZone: JLM,
          loadMore,
        }),
      );
    });
    const btn = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(EN.audit.timeline.loadMore),
    )!;
    click(btn);
    await act(async () => {
      rejectFirst(new Error("TypeError: Failed to fetch"));
      await Promise.resolve();
    });

    // Rows preserved; a localized alert + retry offered; no raw error text.
    assert.ok(container.querySelector("ol > li"), "the existing rows survive");
    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert, "a transport rejection still surfaces an alert");
    assert.doesNotMatch(
      container.textContent ?? "",
      /Failed to fetch|TypeError|stack/,
      "raw transport error text never reaches the DOM",
    );

    // The guard is released: Retry issues a SECOND request and recovers.
    const retry = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(EN.audit.timeline.retry),
    )!;
    assert.ok(retry, "retry is offered (the in-flight guard did not stick)");
    await act(async () => {
      retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(calls, 2, "the guard was released — retry actually re-requested");
    assert.equal(container.querySelectorAll("ol > li").length, 2, "recovered");

    act(() => root.unmount());
    container.remove();
  });

  it("an ok reply with NO page is treated as a failure, not as an empty timeline", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: true }); // malformed: ok but no page
    assert.equal(rows(h).length, 1, "the existing rows survive");
    assert.ok(text(h).includes(EN.audit.timeline.loadError));
  });

  it("an order with no history shows a CALM empty state, not an error", () => {
    const h = mount({ initial: page([]) });
    const body = text(h);
    assert.ok(body.includes(EN.audit.timeline.empty));
    assert.ok(body.includes(EN.audit.timeline.emptyHint));
    assert.equal($(h, '[role="alert"]'), null, "empty is not an error");
    assert.equal(rows(h).length, 0);
    // And no creation event is fabricated to fill the gap.
    assert.doesNotMatch(body, new RegExp(EN.audit.order.events["order.created"]));
  });
});

describe("OrderTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no raw enum`, () => {
      const dict = getDictionary(locale);
      const h = mount({
        initial: page([CREATED, STATUS, UPDATED, LINKED, LEGACY]),
        locale,
      });
      const body = text(h);
      assert.ok(body.includes(dict.audit.order.events["order.created"]));
      assert.ok(body.includes(dict.audit.order.events["order.status_changed"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.ok(body.includes(dict.status.new));
      // The English strings must NOT bleed into an RTL locale.
      assert.doesNotMatch(body, /Order created|Status changed|Load more/);
      assert.doesNotMatch(body, /from_status|order_number|MDF-1043/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([CREATED, STATUS]), locale: "en" });
    assert.ok(text(h).includes("Order created"));
  });

  it("bidi-isolates the actor email in an RTL locale", () => {
    const h = mount({ initial: page([CREATED]), locale: "he" });
    const iso = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(
      iso.includes("owner@madaf.local"),
      "the email stays LTR inside a Hebrew sentence",
    );
  });

  it("the directional arrow mirrors under RTL and is decorative", () => {
    const h = mount({ initial: page([STATUS]), locale: "ar" });
    const arrow = $(h, "svg.rtl\\:-scale-x-100");
    assert.ok(arrow, "the → glyph is mirrored for RTL");
  });

  it("rows use logical spacing and wrap — no fixed physical layout to overflow", () => {
    const h = mount({ initial: page([STATUS]) });
    const html = h.container.innerHTML;
    // Chips wrap instead of forcing a horizontal overflow on a phone.
    assert.match(html, /flex-wrap/);
    // No physical left/right margins that would break RTL.
    assert.doesNotMatch(html, /\b(ml|mr|pl|pr)-\d/);
  });

  it("a long actor email WRAPS (break-all) rather than overflowing the phone", () => {
    const long: TimelineActor = {
      kind: "named",
      label: "purchasing.department@long-company-name.example.co.il",
    };
    const h = mount({
      initial: page([event("1", "order.created", { item_count: 1 }, long)]),
    });
    const emailSpan = $$(h, 'span[dir="ltr"]').find(
      (s) => (s.textContent ?? "").includes("@"),
    );
    assert.ok(emailSpan, "the email is bidi-isolated");
    // An email is a single unbreakable token; break-all is what lets it wrap
    // inside the card instead of pushing horizontal page overflow.
    assert.match(emailSpan.className, /break-all/);
  });
});
