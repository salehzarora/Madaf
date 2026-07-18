/**
 * M8I.5 — MOUNTED AssignmentTimeline INTEGRATION TESTS.
 *
 * Mount the REAL component with a hand-resolved "load more" action, so pending
 * states, stale replies and overlapping clicks are observable. Pins:
 *   • rows render the real M8I.5 events with localized labels;
 *   • the affected customer renders from the customer_name SNAPSHOT (dir=auto) and
 *     the representative from the rep_email SNAPSHOT (bidi-isolated, dir=ltr),
 *     never a raw UUID, and both stay legible after removal;
 *   • the source line renders per event+source (created→manual; removed→each);
 *   • the rep_user_id UUID + any smuggled secret NEVER render (projection drops them);
 *   • an UNRECOGNIZED event → the explicit unknown label, no raw metadata;
 *   • timestamps render in the TENANT zone; actor fallbacks are localized;
 *   • keyset pagination + ref guard; isolated initial-failure retry; load-more
 *     error retry; calm empty state; ar/he RTL / en LTR.
 *
 * Runner: `npm run test:assignment-timeline-ui` (plain tsx — NOT react-server).
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { AssignmentTimeline } from "@/components/admin/assignment-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { AssignmentTimelineActionResult } from "@/lib/actions/assignment-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  buildSalesRepAssignmentTimelineEvent,
  type SalesRepAssignmentTimelineInitial,
  type SalesRepAssignmentTimelinePage,
} from "@/lib/sales-rep-assignment-timeline";
import { formatTenantDateTime } from "@/lib/time";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
const INSTANT = "2026-07-01T23:30:00Z";
const REP_UUID = "11111111-1111-4111-8111-111111111111";

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
  return buildSalesRepAssignmentTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const CREATED = event("1", "sales_rep_assignment.created", {
  rep_user_id: REP_UUID,
  rep_email: "rep@t.local",
  customer_name: "بقالة النور",
  source: "manual",
});
const REMOVED_ROLE = event(
  "2",
  "sales_rep_assignment.removed",
  {
    rep_user_id: REP_UUID,
    rep_email: "mgr@t.local",
    customer_name: "Corner Market",
    source: "role_changed",
    // A smuggled secret that must NEVER render (projection drops it).
    token: "raw-secret-tok",
  },
  FORMER,
);
const REMOVED_JOIN = event(
  "3",
  "sales_rep_assignment.removed",
  { rep_user_id: REP_UUID, rep_email: "gone@t.local", customer_name: "חנות הפינה", source: "member_joined" },
  UNKNOWN,
);
/** Outside the closed catalog carrying a stray secret key. */
const LEGACY = event(
  "4",
  "sales_rep_assignment.bogus",
  { rep_email: "x@t.local", customer_name: "secret-shop", source: "manual", email_body: "secret-body" },
  UNKNOWN,
);

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): SalesRepAssignmentTimelinePage => ({
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
  requests: { cursor?: string | null }[];
  answer: (i: number, r: AssignmentTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: SalesRepAssignmentTimelinePage;
  initialFailed?: boolean;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<AssignmentTimelineActionResult>>[] = [];

  const loadMore = (input: { cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<AssignmentTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const initialProp: SalesRepAssignmentTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(AssignmentTimeline, {
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

describe("AssignmentTimeline — rendering the real M8I.5 events", () => {
  it("renders one list item per event with localized titles", () => {
    const h = mount({ initial: page([CREATED, REMOVED_ROLE, REMOVED_JOIN]) });
    assert.equal(rows(h).length, 3);
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.assignment.events["sales_rep_assignment.created"]));
    assert.ok(body.includes(EN.audit.assignment.events["sales_rep_assignment.removed"]));
  });

  it("shows the customer (dir=auto) and rep email (dir=ltr) from snapshots", () => {
    const h = mount({ initial: page([CREATED, REMOVED_JOIN]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("rep@t.local"));
    // A removed rep's identity remains legible from the snapshot.
    assert.ok(mono.includes("gone@t.local"));
    const auto = $$(h, 'span[dir="auto"]').map((s) => s.textContent);
    assert.ok(auto.includes("بقالة النور"));
    assert.ok(auto.includes("חנות הפינה"));
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.assignment.customer));
    assert.ok(body.includes(EN.audit.assignment.representative));
  });

  it("renders the localized source line per event + source", () => {
    const s = EN.audit.assignment.sources;
    assert.ok(textOf(mount({ initial: page([CREATED]) })).includes(s.createdManual));
    assert.ok(textOf(mount({ initial: page([REMOVED_ROLE]) })).includes(s.role_changed));
    assert.ok(textOf(mount({ initial: page([REMOVED_JOIN]) })).includes(s.member_joined));
  });

  it("a smuggled token/secret value NEVER renders", () => {
    const h = mount({ initial: page([REMOVED_ROLE]) });
    assert.doesNotMatch(textOf(h), /raw-secret-tok/);
    assert.ok(!("token" in REMOVED_ROLE.metadata));
    assert.ok(!JSON.stringify(REMOVED_ROLE).includes("raw-secret-tok"));
  });

  it("never renders a raw UUID (rep_user_id is dropped by the projection)", () => {
    const h = mount({ initial: page([CREATED, REMOVED_ROLE, REMOVED_JOIN]) });
    assert.doesNotMatch(textOf(h), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    assert.ok(!("rep_user_id" in CREATED.metadata));
  });
});

describe("AssignmentTimeline — unknown event", () => {
  it("labels it unrecognized, never 'Other', dumps no metadata", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
    assert.doesNotMatch(body, /\{|\}/);
    assert.doesNotMatch(body, /secret-shop|secret-body|email_body/);
  });
});

describe("AssignmentTimeline — timezone + actor", () => {
  it("renders the timestamp in the TENANT zone; the DATE moves under UTC", () => {
    const a = mount({ initial: page([CREATED]), timeZone: JLM });
    const b = mount({ initial: page([CREATED]), timeZone: UTC });
    assert.notEqual(textOf(a), textOf(b));
    assert.ok(textOf(a).includes(formatTenantDateTime(INSTANT, "en", JLM)));
    assert.match(textOf(a), /02:30|2:30/);
    assert.match(textOf(b), /23:30/);
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([CREATED, REMOVED_ROLE]) });
    assert.doesNotMatch(textOf(h), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("shows a named actor bidi-isolated, and localized former/unknown fallbacks", () => {
    const h = mount({ initial: page([CREATED, REMOVED_ROLE, REMOVED_JOIN]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"));
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });
});

describe("AssignmentTimeline — pagination + errors", () => {
  it("Load more only when there IS more; appends + dedupes", async () => {
    const none = mount({ initial: page([CREATED]) });
    assert.equal(loadMoreButton(none), undefined);
    const h = mount({ initial: page([CREATED, REMOVED_ROLE], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { cursor: "cur-1" });
    await h.answer(0, { ok: true, page: page([REMOVED_ROLE, REMOVED_JOIN]) });
    assert.equal(rows(h).length, 3, "REMOVED_ROLE not duplicated");
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
    assert.deepEqual(h.requests[0], {});
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

describe("AssignmentTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no raw value`, () => {
      const dict = getDictionary(locale);
      const h = mount({ initial: page([CREATED, REMOVED_ROLE, LEGACY]), locale });
      const body = textOf(h);
      assert.ok(body.includes(dict.audit.assignment.events["sales_rep_assignment.created"]));
      assert.ok(body.includes(dict.audit.assignment.events["sales_rep_assignment.removed"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.doesNotMatch(body, /Sales representative assigned|Load more/);
      assert.doesNotMatch(body, /raw-secret-tok|email_body/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([CREATED]), locale: "en" });
    assert.ok(textOf(h).includes("Sales representative assigned"));
  });
});
