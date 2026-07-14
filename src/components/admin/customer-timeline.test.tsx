/**
 * PILOT-READINESS-BATCH-A / A3 — MOUNTED CustomerTimeline tests.
 *
 * Mirror of the M8H.3 order-timeline mounted tests: the customer timeline now
 * isolates its optional initial read and renders a localized, retryable error IN
 * PLACE on failure (never crashing the Customer Details page and never faking
 * "no activity"). These mount the REAL component with the bounded action injected
 * as a prop and resolved by hand, so the initial-failure, retry-first-page,
 * empty-after-retry, failed-retry, transport-rejection, dedupe, load-more, RTL
 * and no-raw-error behaviours are all verified behaviourally.
 *
 * Runner: `npm run test:customer-timeline-ui` (plain tsx — NOT
 * --conditions=react-server, which would resolve React to its server build).
 */
// FIRST: the DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { CustomerTimeline } from "@/components/admin/customer-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { TimelineActionResult } from "@/lib/actions/customer-timeline";
import {
  buildTimelineEvent,
  type CustomerTimelineInitial,
  type TimelineActor,
  type TimelinePage,
} from "@/lib/customer-timeline";

const JLM = "Asia/Jerusalem";
const CUSTOMER = "c01";
const EN = getDictionary("en");

const OWNER: TimelineActor = { kind: "named", label: "owner@madaf.local" };

function ev(id: string, eventType: string, metadata: Record<string, unknown> = {}) {
  return buildTimelineEvent({
    id,
    eventType,
    createdAt: "2026-07-01T09:30:00Z",
    actor: OWNER,
    metadata,
  });
}

const CREATED = ev("1", "customer.created", { origin: "manual" });
const UPDATED = ev("2", "customer.updated", { changed_fields: ["name"] });

const page = (
  events: ReturnType<typeof ev>[],
  nextCursor: string | null = null,
): TimelinePage => ({ events, nextCursor, hasMore: nextCursor !== null });

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
  requests: { customerId: string; cursor?: string | null }[];
  answer: (i: number, r: TimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}
let harnesses: Harness[] = [];

function mount(opts: {
  initial?: TimelinePage;
  initialFailed?: boolean;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const requests: { customerId: string; cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<TimelineActionResult>>[] = [];
  const loadMore = (input: { customerId: string; cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<TimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };
  const initial: CustomerTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };
  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(CustomerTimeline, {
        customerId: CUSTOMER,
        locale,
        dict: getDictionary(locale),
        initial,
        timeZone: JLM,
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
const text = (h: Harness) => h.container.textContent ?? "";
const rows = (h: Harness) => [...h.container.querySelectorAll("ol > li")];
const button = (h: Harness, label: string) =>
  [...h.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;
const loadMoreBtn = (h: Harness) => button(h, EN.audit.timeline.loadMore);
const retryBtn = (h: Harness) => button(h, EN.audit.timeline.retry);
function click(el: Element) {
  act(() => {
    (el as HTMLButtonElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
}

describe("CustomerTimeline — initial read failure (A3) is contained + retryable", () => {
  it("renders a localized error + retry IN PLACE, not the empty state", () => {
    const h = mount({ initialFailed: true });
    const body = text(h);
    assert.ok($(h, '[role="alert"]'), "initial failure uses alert semantics");
    assert.ok(body.includes(EN.audit.timeline.error));
    assert.ok(
      !body.includes(EN.audit.timeline.loadError),
      "the initial state uses the general error, not the 'load more' wording",
    );
    assert.ok(retryBtn(h), "a retry control is offered");
    assert.ok(!body.includes(EN.audit.timeline.empty), "not the empty state");
    assert.equal(rows(h).length, 0);
  });

  it("never leaks raw backend text on the initial failure", () => {
    const h = mount({ initialFailed: true });
    assert.doesNotMatch(
      text(h),
      /error:|stack|supabase|PGRST|postgres:|column .* does not exist/i,
    );
  });

  it("retry performs a FRESH first-page read (no cursor) and recovers", async () => {
    const h = mount({ initialFailed: true });
    click(retryBtn(h)!);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0], { customerId: CUSTOMER });
    await h.answer(0, { ok: true, page: page([CREATED, UPDATED], "cur-9") });
    assert.equal($(h, '[role="alert"]'), null, "the initial error cleared");
    assert.equal(rows(h).length, 2);
    assert.ok(loadMoreBtn(h), "pagination is live again");
  });

  it("a retry that succeeds with an empty history shows the calm empty state", async () => {
    const h = mount({ initialFailed: true });
    click(retryBtn(h)!);
    await h.answer(0, { ok: true, page: page([]) });
    assert.equal($(h, '[role="alert"]'), null);
    assert.ok(text(h).includes(EN.audit.timeline.empty));
    assert.equal(rows(h).length, 0);
  });

  it("a FAILED retry stays a contained, still-retryable error", async () => {
    const h = mount({ initialFailed: true });
    click(retryBtn(h)!);
    await h.answer(0, { ok: false });
    assert.ok($(h, '[role="alert"]'));
    assert.ok(retryBtn(h), "retry still offered after a failed retry");
    click(retryBtn(h)!);
    assert.equal(h.requests.length, 2);
    await h.answer(1, { ok: true, page: page([CREATED]) });
    assert.equal(rows(h).length, 1, "eventually recovers");
  });

  it("a retry that REJECTS (transport) stays contained and retryable", async () => {
    const container = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(container);
    let calls = 0;
    let rejectFirst!: (e: unknown) => void;
    const loadMore = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<TimelineActionResult>((_r, rej) => {
          rejectFirst = rej;
        });
      }
      return Promise.resolve<TimelineActionResult>({
        ok: true,
        page: page([CREATED]),
      });
    };
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(CustomerTimeline, {
          customerId: CUSTOMER,
          locale: "en",
          dict: EN,
          initial: { ok: false },
          timeZone: JLM,
          loadMore,
        }),
      );
    });
    const retry = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(EN.audit.timeline.retry),
    )!;
    retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await act(async () => {
      rejectFirst(new Error("TypeError: Failed to fetch"));
      await Promise.resolve();
    });
    assert.ok(container.querySelector('[role="alert"]'), "still contained");
    const retry2 = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(EN.audit.timeline.retry),
    )!;
    assert.ok(retry2, "guard released — a second retry is possible");
    await act(async () => {
      retry2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(calls, 2, "the second retry actually re-requested");
    assert.equal(container.querySelectorAll("ol > li").length, 1, "recovered");
    act(() => root.unmount());
    container.remove();
  });
});

describe("CustomerTimeline — load more (initial success) still hardened", () => {
  it("appends older pages, deduped, without a stale repeat", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreBtn(h)!);
    assert.deepEqual(h.requests[0], { customerId: CUSTOMER, cursor: "cur-1" });
    await h.answer(0, { ok: true, page: page([CREATED, UPDATED]) }); // repeats CREATED
    assert.equal(rows(h).length, 2, "CREATED is not duplicated");
  });

  it("a failed load KEEPS the rendered events and offers retry", async () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    click(loadMoreBtn(h)!);
    await h.answer(0, { ok: false });
    assert.equal(rows(h).length, 1, "the store's history is still on screen");
    assert.ok(text(h).includes(EN.audit.timeline.loadError));
    assert.equal($(h, '[role="alert"]') !== null, true);
  });

  it("an overlapping click cannot fire a second concurrent request", () => {
    const h = mount({ initial: page([CREATED], "cur-1") });
    const btn = loadMoreBtn(h)!;
    click(btn);
    click(btn);
    click(btn);
    assert.equal(h.requests.length, 1, "the in-flight guard holds");
  });

  it("an initial success with zero events shows the calm empty state", () => {
    const h = mount({ initial: page([]) });
    assert.ok(text(h).includes(EN.audit.timeline.empty));
    assert.equal($(h, '[role="alert"]'), null);
  });
});

describe("CustomerTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} initial error with no hardcoded English`, () => {
      const dict = getDictionary(locale);
      const h = mount({ initialFailed: true, locale });
      const body = text(h);
      assert.ok(body.includes(dict.audit.timeline.error));
      assert.ok(body.includes(dict.audit.timeline.retry));
      assert.doesNotMatch(body, /Couldn't load|Try again|Retry/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initialFailed: true, locale: "en" });
    assert.ok(text(h).includes(EN.audit.timeline.error));
  });
});
