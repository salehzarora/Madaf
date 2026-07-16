/**
 * M8I.2 — MOUNTED InventoryTimeline INTEGRATION TESTS.
 *
 * Mount the REAL component with a hand-resolved "load more" action, so pending
 * states, stale replies and overlapping clicks are observable. Pins:
 *   • rows render the real M8I.2 events with localized labels;
 *   • inventory.created shows the safe initial quantity + threshold;
 *   • inventory.updated shows per-field before → after (config only); a smuggled
 *     quantity value NEVER renders; location renders as plain text (no HTML);
 *   • an UNRECOGNIZED event → the explicit unknown label, no raw metadata;
 *   • timestamps render in the TENANT zone; actor fallbacks are localized;
 *   • keyset pagination + ref guard; isolated initial-failure retry; load-more
 *     error retry; calm empty state; ar/he RTL / en LTR.
 *
 * Runner: `npm run test:inventory-timeline-ui` (plain tsx — NOT react-server).
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { InventoryTimeline } from "@/components/admin/inventory-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { InventoryTimelineActionResult } from "@/lib/actions/inventory-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  buildInventoryTimelineEvent,
  type InventoryTimelineInitial,
  type InventoryTimelinePage,
} from "@/lib/inventory-timeline";
import { formatTenantDateTime } from "@/lib/time";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
const INSTANT = "2026-07-01T23:30:00Z";
const PRODUCT = "40000000-0000-4000-8000-000000000001";

const OWNER: TimelineActor = { kind: "named", label: "owner@madaf.local" };
const FORMER: TimelineActor = { kind: "former" };
const UNKNOWN: TimelineActor = { kind: "unknown" };

function event(
  id: string,
  eventType: string,
  metadata: Record<string, unknown>,
  actor: TimelineActor = OWNER,
  createdAt = INSTANT,
) {
  return buildInventoryTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const CREATED = event("1", "inventory.created", { quantity: 120, threshold: 10 });
const UPDATED = event(
  "2",
  "inventory.updated",
  {
    changed_fields: ["threshold", "location"],
    threshold: { from: 10, to: 24 },
    location: { from: "A-03", to: "B-11" },
    // A smuggled quantity value that must NEVER render (projection drops it).
    quantity: { from: 999, to: 7 },
    quantity_available: 7,
  },
  FORMER,
);
/** Outside the closed catalog carrying a stray key. */
const LEGACY = event("3", "inventory.quantity_set", { before: 5, after: 99 }, UNKNOWN);

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): InventoryTimelinePage => ({
  events,
  nextCursor,
  hasMore: nextCursor !== null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  container: HTMLElement;
  requests: { productId: string; cursor?: string | null }[];
  answer: (i: number, r: InventoryTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: InventoryTimelinePage;
  initialFailed?: boolean;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { productId: string; cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<InventoryTimelineActionResult>>[] = [];

  const loadMore = (input: { productId: string; cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<InventoryTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const initialProp: InventoryTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(InventoryTimeline, {
        productId: PRODUCT,
        locale,
        dict: getDictionary(locale),
        initial: initialProp,
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

const $ = (h: Harness, sel: string) => h.container.querySelector(sel);
const $$ = (h: Harness, sel: string) => [...h.container.querySelectorAll(sel)];
const textOf = (h: Harness) => h.container.textContent ?? "";
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

describe("InventoryTimeline — rendering the real M8I.2 events", () => {
  it("renders one list item per event with localized titles", () => {
    const h = mount({ initial: page([CREATED, UPDATED]) });
    assert.equal(rows(h).length, 2);
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.inventory.events["inventory.created"]));
    assert.ok(body.includes(EN.audit.inventory.events["inventory.updated"]));
  });

  it("inventory.created shows the safe initial quantity + threshold", () => {
    const h = mount({ initial: page([CREATED]) });
    const body = textOf(h);
    assert.ok(body.includes("120"));
    assert.ok(body.includes("10"));
  });

  it("inventory.updated shows per-field before → after — config only, no quantity", () => {
    const h = mount({ initial: page([UPDATED]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.inventory.fields.threshold));
    assert.ok(body.includes("24"));
    assert.ok(body.includes(EN.audit.inventory.fields.location));
    assert.ok(body.includes("A-03") && body.includes("B-11"));
    // The smuggled quantity value NEVER renders.
    assert.doesNotMatch(body, /999/);
  });

  it("the event handed to the client carries NO quantity key on inventory.updated", () => {
    assert.ok(!("quantity" in UPDATED.metadata));
    assert.ok(!("quantity_available" in UPDATED.metadata));
    assert.ok(!JSON.stringify(UPDATED).includes("999"));
    // An unknown event ships no metadata.
    assert.deepEqual(LEGACY.metadata, {});
  });

  it("location renders as escaped text — a hostile value never becomes HTML", () => {
    const hostile = event("9", "inventory.updated", {
      changed_fields: ["location"],
      location: { from: "A-1", to: "<img src=x onerror=alert(1)>".padEnd(60, "y") },
    });
    const h = mount({ initial: page([hostile]) });
    // Oversized/hostile 'to' is dropped by the projection; no HTML injected.
    assert.equal($(h, "img"), null);
    assert.doesNotMatch(h.container.innerHTML, /onerror=/);
  });
});

describe("InventoryTimeline — unknown event", () => {
  it("labels it unrecognized, never 'Other', dumps no metadata", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
    assert.doesNotMatch(body, /\{|\}/);
    assert.doesNotMatch(body, /quantity_set|99/);
  });
});

describe("InventoryTimeline — timezone + actor", () => {
  it("renders the timestamp in the TENANT zone; the DATE moves under UTC", () => {
    const a = mount({ initial: page([CREATED]), timeZone: JLM });
    const b = mount({ initial: page([CREATED]), timeZone: UTC });
    assert.notEqual(textOf(a), textOf(b));
    assert.ok(textOf(a).includes(formatTenantDateTime(INSTANT, "en", JLM)));
    assert.match(textOf(a), /02:30|2:30/);
    assert.match(textOf(b), /23:30/);
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([CREATED, UPDATED]) });
    assert.doesNotMatch(textOf(h), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("shows a named actor bidi-isolated, and localized former/unknown fallbacks", () => {
    const h = mount({ initial: page([CREATED, UPDATED, LEGACY]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"));
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
    assert.doesNotMatch(body, /\bu-owner\b/i);
  });
});

describe("InventoryTimeline — pagination + errors", () => {
  it("Load more only when there IS more; appends + dedupes", async () => {
    const none = mount({ initial: page([CREATED]) });
    assert.equal(loadMoreButton(none), undefined);
    const h = mount({ initial: page([CREATED, UPDATED], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { productId: PRODUCT, cursor: "cur-1" });
    await h.answer(0, { ok: true, page: page([UPDATED, LEGACY]) });
    assert.equal(rows(h).length, 3, "UPDATED not duplicated");
  });

  it("an un-acted click burst cannot fire a second request (ref guard)", () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    clickBurst(loadMoreButton(h)!, 3);
    assert.equal(h.requests.length, 1);
  });

  it("initial-read failure is contained + retryable, never faking empty", () => {
    const h = mount({ initialFailed: true });
    const body = textOf(h);
    assert.ok($(h, '[role="alert"]'));
    assert.ok(body.includes(EN.audit.timeline.error));
    assert.ok(retryButton(h));
    assert.ok(!body.includes(EN.audit.timeline.empty));
    assert.doesNotMatch(body, /error:|stack|supabase|PGRST/i);
  });

  it("retry performs a fresh first-page read and recovers", async () => {
    const h = mount({ initialFailed: true });
    click(retryButton(h)!);
    assert.deepEqual(h.requests[0], { productId: PRODUCT });
    await h.answer(0, { ok: true, page: page([CREATED]) });
    assert.equal($(h, '[role="alert"]'), null);
    assert.equal(rows(h).length, 1);
  });

  it("a failed load keeps the rows + offers retry; empty is calm", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });
    assert.equal(rows(h).length, 1);
    assert.ok(textOf(h).includes(EN.audit.timeline.loadError));
    const empty = mount({ initial: page([]) });
    assert.ok(textOf(empty).includes(EN.audit.timeline.empty));
    assert.equal($(empty, '[role="alert"]'), null);
  });
});

describe("InventoryTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no raw value`, () => {
      const dict = getDictionary(locale);
      const h = mount({ initial: page([CREATED, UPDATED, LEGACY]), locale });
      const body = textOf(h);
      assert.ok(body.includes(dict.audit.inventory.events["inventory.created"]));
      assert.ok(body.includes(dict.audit.inventory.events["inventory.updated"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.doesNotMatch(body, /Stock tracking started|Stock settings updated|Load more/);
      assert.doesNotMatch(body, /999|quantity_set/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([CREATED]), locale: "en" });
    assert.ok(textOf(h).includes("Stock tracking started"));
  });
});
