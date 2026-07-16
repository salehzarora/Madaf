/**
 * M8I.1 — MOUNTED ProductTimeline INTEGRATION TESTS.
 *
 * These mount the REAL component (no copy, no re-implementation), with the
 * "load more" Server Action supplied through the production injection seam and
 * resolved BY HAND — so intermediate renders (the pending state, a stale reply,
 * an overlapping click) are actually observable rather than assumed.
 *
 * What they pin, behaviourally:
 *   • rows render the real M8I.1 events with their localized labels;
 *   • product.updated is a safe SUMMARY — field KEY labels, never the VALUES;
 *   • an UNRECOGNIZED event renders the explicit unknown label and NEVER raw
 *     metadata / JSON;
 *   • timestamps render in the TENANT's zone, not the device's or the server's;
 *   • actor fallbacks (named / former / team-member / unknown) are localized and
 *     never a raw user id;
 *   • Load more appends without duplicating, an overlapping click cannot fire a
 *     second request, a failure KEEPS the rows and offers Retry, and Retry works;
 *   • an isolated initial-read FAILURE is contained + retryable and never fakes
 *     an empty history;
 *   • the empty state is calm, not an error;
 *   • ar/he render RTL-safely and en LTR.
 *
 * Runner: `npm run test:product-timeline-ui` (plain tsx — NOT
 * --conditions=react-server, which would resolve React to its server build).
 */
// FIRST: the DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { ProductTimeline } from "@/components/admin/product-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { ProductTimelineActionResult } from "@/lib/actions/product-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  buildProductTimelineEvent,
  type ProductTimelineInitial,
  type ProductTimelinePage,
} from "@/lib/product-timeline";
import { formatTenantDateTime } from "@/lib/time";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
/** 23:30Z is 02:30 the NEXT DAY in Jerusalem (+03 in July) — so a timezone bug
 * cannot hide behind an hour-only difference; the DATE moves too. */
const INSTANT = "2026-07-01T23:30:00Z";
const PRODUCT = "40000000-0000-4000-8000-000000000001";

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
  return buildProductTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const CREATED = event("1", "product.created", {});
const UPDATED = event(
  "2",
  "product.updated",
  {
    changed_fields: ["name", "wholesale_price", "package"],
    // Smuggled VALUES that must never render (the projection drops them).
    name: "Secret Product Ltd",
    wholesale_price: 99.5,
    image: "https://madaf-drab.vercel.app/storage/tenant/secret.png",
  },
  FORMER,
);
const ACTIVATED = event(
  "3",
  "product.activated",
  { before_active: false, after_active: true },
  UNKNOWN,
);
const DEACTIVATED = event("4", "product.deactivated", {
  before_active: true,
  after_active: false,
});
/** An event OUTSIDE the closed catalog carrying a stray value key. */
const LEGACY = event("5", "product.imported", { image_url: "SECRET-URL" });

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): ProductTimelinePage => ({
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
  answer: (i: number, r: ProductTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: ProductTimelinePage;
  initialFailed?: boolean;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { productId: string; cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<ProductTimelineActionResult>>[] = [];

  const loadMore = (input: { productId: string; cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<ProductTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const initialProp: ProductTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ProductTimeline, {
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

/** Fire N clicks in ONE synchronous, UN-acted turn — so React has not committed
 * the `disabled` / pending re-render between them (isolates the ref guard). */
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

describe("ProductTimeline — rendering the real M8I.1 events", () => {
  it("renders one semantic list item per event, newest-first as given", () => {
    const h = mount({ initial: page([CREATED, UPDATED, ACTIVATED, DEACTIVATED]) });
    assert.equal(rows(h).length, 4);
    assert.ok($(h, "ol"));
  });

  it("shows the localized title for every event type", () => {
    const h = mount({ initial: page([CREATED, UPDATED, ACTIVATED, DEACTIVATED]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.product.events["product.created"]));
    assert.ok(body.includes(EN.audit.product.events["product.updated"]));
    assert.ok(body.includes(EN.audit.product.events["product.activated"]));
    assert.ok(body.includes(EN.audit.product.events["product.deactivated"]));
  });

  it("renders product.updated as a safe SUMMARY — field names, never values", () => {
    const h = mount({ initial: page([UPDATED]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.product.fields.name));
    assert.ok(body.includes(EN.audit.product.fields.wholesale_price));
    assert.ok(body.includes(EN.audit.product.fields.package));
    // The smuggled VALUES never surface.
    assert.doesNotMatch(body, /Secret Product Ltd|99\.5|secret\.png|storage|https?:/i);
  });

  it("activation / deactivation carry the whole story in the label (no leaky detail)", () => {
    const h = mount({ initial: page([ACTIVATED, DEACTIVATED]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.product.events["product.activated"]));
    assert.ok(body.includes(EN.audit.product.events["product.deactivated"]));
    // No raw boolean keys leak into the DOM.
    assert.doesNotMatch(body, /before_active|after_active|true|false/);
  });

  it("the event handed to the client carries NO raw value keys", () => {
    assert.ok(!("name" in UPDATED.metadata));
    assert.ok(!("wholesale_price" in UPDATED.metadata));
    assert.ok(!("image" in UPDATED.metadata));
    assert.deepEqual(UPDATED.metadata.changed_fields, [
      "name",
      "wholesale_price",
      "package",
    ]);
    // Lifecycle safe booleans are not projected (the label is the whole story).
    assert.deepEqual(ACTIVATED.metadata, {});
    // An unknown event ships no metadata at all.
    assert.deepEqual(LEGACY.metadata, {});
    assert.ok(!JSON.stringify(LEGACY).includes("SECRET-URL"));
  });
});

describe("ProductTimeline — unknown event", () => {
  it("labels it explicitly as unrecognized, never 'Other', and dumps no metadata", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
    assert.doesNotMatch(body, /SECRET-URL|image_url/);
    assert.doesNotMatch(body, /\{|\}/); // no JSON dumped anywhere
  });

  it("does not crash the rest of the timeline", () => {
    const h = mount({ initial: page([LEGACY, CREATED, UPDATED]) });
    assert.equal(rows(h).length, 3);
    assert.ok(textOf(h).includes(EN.audit.product.events["product.created"]));
  });
});

describe("ProductTimeline — tenant timezone is the only authority", () => {
  it("renders the timestamp in the TENANT's zone; the DATE moves under UTC", () => {
    const a = mount({ initial: page([CREATED]), timeZone: JLM });
    const b = mount({ initial: page([CREATED]), timeZone: UTC });
    const inJlm = textOf(a);
    const inUtc = textOf(b);
    assert.notEqual(inJlm, inUtc);
    assert.ok(inJlm.includes(formatTenantDateTime(INSTANT, "en", JLM)));
    assert.match(inJlm, /02:30|2:30/);
    assert.match(inUtc, /23:30/);
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([CREATED, UPDATED, ACTIVATED]) });
    const body = textOf(h);
    assert.doesNotMatch(body, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.doesNotMatch(body, /\dZ\b/);
  });
});

describe("ProductTimeline — actor display", () => {
  it("shows a named actor bidi-isolated, never a raw user id", () => {
    const h = mount({ initial: page([CREATED]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"));
    assert.doesNotMatch(textOf(h), /\bu-owner\b/i);
  });

  it("falls back to localized labels for former / member / unknown actors", () => {
    const h = mount({
      initial: page([
        event("1", "product.created", {}, FORMER),
        event("2", "product.created", {}, MEMBER),
        event("3", "product.created", {}, UNKNOWN),
      ]),
    });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorMember));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });
});

describe("ProductTimeline — pagination", () => {
  it("shows Load more only when there IS more", () => {
    const none = mount({ initial: page([CREATED]) });
    assert.equal(loadMoreButton(none), undefined);
    const more = mount({ initial: page([CREATED], "cur-1") });
    assert.ok(loadMoreButton(more));
  });

  it("sends the opaque cursor and APPENDS the older page", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { productId: PRODUCT, cursor: "cur-1" });

    await h.answer(0, { ok: true, page: page([UPDATED, ACTIVATED]) });
    assert.equal(rows(h).length, 3);
    assert.equal(loadMoreButton(h), undefined);
  });

  it("DEDUPES by audit id — a repeated row can never render twice", async () => {
    const h = mount({ initial: page([CREATED, UPDATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: true, page: page([UPDATED, ACTIVATED]) });
    assert.equal(rows(h).length, 3, "UPDATED is not duplicated");
  });

  it("an UN-ACTED click burst cannot fire a second request (the ref guard)", () => {
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
  });
});

describe("ProductTimeline — initial read failure is contained + retryable", () => {
  it("renders a localized error + retry IN PLACE, not the empty state", () => {
    const h = mount({ initialFailed: true });
    const body = textOf(h);
    assert.ok($(h, '[role="alert"]'), "the initial failure uses alert semantics");
    assert.ok(body.includes(EN.audit.timeline.error));
    assert.ok(!body.includes(EN.audit.timeline.loadError));
    assert.ok(retryButton(h), "a retry control is offered");
    assert.ok(!body.includes(EN.audit.timeline.empty));
    assert.equal(rows(h).length, 0);
  });

  it("never leaks raw backend text on the initial failure", () => {
    const h = mount({ initialFailed: true });
    assert.doesNotMatch(
      textOf(h),
      /error:|stack|supabase|PGRST|postgres:|column .* does not exist/i,
    );
  });

  it("retry performs a FRESH first-page read (no cursor) and recovers", async () => {
    const h = mount({ initialFailed: true });
    click(retryButton(h)!);
    assert.deepEqual(h.requests[0], { productId: PRODUCT });
    await h.answer(0, { ok: true, page: page([CREATED, UPDATED], "cur-9") });
    assert.equal($(h, '[role="alert"]'), null, "the initial error cleared");
    assert.equal(rows(h).length, 2);
    assert.ok(loadMoreButton(h));
  });

  it("a retry that SUCCEEDS with an empty history shows the calm empty state", async () => {
    const h = mount({ initialFailed: true });
    click(retryButton(h)!);
    await h.answer(0, { ok: true, page: page([]) });
    assert.equal($(h, '[role="alert"]'), null);
    assert.ok(textOf(h).includes(EN.audit.timeline.empty));
  });
});

describe("ProductTimeline — load error, retry, empty", () => {
  it("a failed load KEEPS the rendered events and offers a retry", async () => {
    const h = mount({ initial: page([CREATED, UPDATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });
    assert.equal(rows(h).length, 2, "the product's history is still on screen");
    assert.ok(textOf(h).includes(EN.audit.timeline.loadError));
    const alert = $(h, '[role="alert"]');
    assert.ok(alert, "error uses alert semantics");
    assert.doesNotMatch(textOf(h), /error:|stack|supabase|PGRST/i);
  });

  it("Retry re-issues the SAME cursor and recovers", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });
    click(retryButton(h)!);
    assert.deepEqual(h.requests[1], { productId: PRODUCT, cursor: "cur-1" });
    await h.answer(1, { ok: true, page: page([UPDATED]) });
    assert.equal(rows(h).length, 2);
    assert.ok(!textOf(h).includes(EN.audit.timeline.loadError));
  });

  it("an ok reply with NO page is treated as a failure, not an empty timeline", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: true });
    assert.equal(rows(h).length, 1, "the existing rows survive");
    assert.ok(textOf(h).includes(EN.audit.timeline.loadError));
  });

  it("a product with no history shows a CALM empty state, not an error", () => {
    const h = mount({ initial: page([]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.empty));
    assert.equal($(h, '[role="alert"]'), null);
    assert.equal(rows(h).length, 0);
    // No creation event is fabricated to fill the gap.
    assert.doesNotMatch(body, new RegExp(EN.audit.product.events["product.created"]));
  });
});

describe("ProductTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no raw value`, () => {
      const dict = getDictionary(locale);
      const h = mount({
        initial: page([CREATED, UPDATED, ACTIVATED, DEACTIVATED, LEGACY]),
        locale,
      });
      const body = textOf(h);
      assert.ok(body.includes(dict.audit.product.events["product.created"]));
      assert.ok(body.includes(dict.audit.product.events["product.updated"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.doesNotMatch(body, /Product created|Product updated|Load more/);
      assert.doesNotMatch(body, /Secret Product Ltd|SECRET-URL|image_url/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([CREATED, UPDATED]), locale: "en" });
    assert.ok(textOf(h).includes("Product created"));
  });

  it("rows use logical spacing — no fixed physical margins to break RTL", () => {
    const h = mount({ initial: page([UPDATED]) });
    const html = h.container.innerHTML;
    assert.doesNotMatch(html, /\b(ml|mr|pl|pr)-\d/);
  });
});
