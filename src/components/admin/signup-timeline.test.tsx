/**
 * M8I.6 — MOUNTED SignupTimeline INTEGRATION TESTS.
 *
 * Mount the REAL component with a hand-resolved "load more" action. Pins:
 *   • rows render the real M8I.6 events with localized labels;
 *   • the store name renders from the business_name SNAPSHOT (dir=auto); an
 *     approved row links to the resulting Customer (business_name as the visible
 *     link text; the raw Customer UUID only in the href, never in visible text);
 *     a rejected row is plain text with no link;
 *   • applicant email/phone/notes + any secret NEVER render (projection drops them);
 *   • an UNRECOGNIZED event → the explicit unknown label, no raw metadata;
 *   • timestamps render in the TENANT zone; reviewer fallbacks are localized;
 *   • keyset pagination + ref guard; isolated initial-failure retry; load-more
 *     error retry; calm empty state; ar/he RTL / en LTR.
 *
 * Runner: `npm run test:signup-timeline-ui` (plain tsx — NOT react-server).
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { SignupTimeline } from "@/components/admin/signup-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { SignupTimelineActionResult } from "@/lib/actions/signup-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  buildSignupRequestTimelineEvent,
  type SignupRequestTimelineInitial,
  type SignupRequestTimelinePage,
} from "@/lib/signup-request-timeline";
import { formatTenantDateTime } from "@/lib/time";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
const INSTANT = "2026-07-01T23:30:00Z";
const CUSTOMER_UUID = "44444444-4444-4444-8444-444444444444";

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
  return buildSignupRequestTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const APPROVED = event("1", "customer_signup_request.approved", {
  business_name: "بقالة الفجر",
  resulting_customer_id: CUSTOMER_UUID,
  // Smuggled applicant PII + secret that must NEVER render (projection drops them).
  email: "applicant@x.local",
  notes: "internal",
  token: "raw-secret-tok",
});
const REJECTED = event(
  "2",
  "customer_signup_request.rejected",
  { business_name: "Corner Grocery" },
  FORMER,
);
/** Outside the closed catalog carrying a stray secret key. */
const LEGACY = event(
  "3",
  "customer_signup_request.bogus",
  { business_name: "secret-shop", email_body: "secret-body" },
  UNKNOWN,
);

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): SignupRequestTimelinePage => ({
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
  answer: (i: number, r: SignupTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: SignupRequestTimelinePage;
  initialFailed?: boolean;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<SignupTimelineActionResult>>[] = [];

  const loadMore = (input: { cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<SignupTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const initialProp: SignupRequestTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(SignupTimeline, {
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

describe("SignupTimeline — rendering the real M8I.6 events", () => {
  it("renders one list item per event with localized titles", () => {
    const h = mount({ initial: page([APPROVED, REJECTED]) });
    assert.equal(rows(h).length, 2);
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.signup.events["customer_signup_request.approved"]));
    assert.ok(body.includes(EN.audit.signup.events["customer_signup_request.rejected"]));
    assert.ok(body.includes(EN.audit.signup.business));
  });

  it("approved links to the resulting Customer with business_name as the visible text", () => {
    const h = mount({ initial: page([APPROVED]) });
    const link = $(h, "a") as HTMLAnchorElement | null;
    assert.ok(link, "an approved row renders a link");
    assert.equal(link?.textContent, "بقالة الفجر");
    assert.ok(
      (link?.getAttribute("href") ?? "").includes(`/admin/customers/${CUSTOMER_UUID}`),
      "the href targets the resulting customer",
    );
    // The raw UUID is only in the href — never in visible text.
    assert.doesNotMatch(textOf(h), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });

  it("rejected renders the store name as plain text with no link", () => {
    const h = mount({ initial: page([REJECTED]) });
    assert.equal($(h, "a"), null, "no link on a rejected row");
    assert.ok(textOf(h).includes("Corner Grocery"));
  });

  it("applicant PII + smuggled secrets NEVER render", () => {
    const h = mount({ initial: page([APPROVED]) });
    const body = textOf(h);
    assert.doesNotMatch(body, /applicant@x\.local|internal|raw-secret-tok/);
    assert.ok(!("email" in APPROVED.metadata));
    assert.ok(!("token" in APPROVED.metadata));
    assert.ok(!JSON.stringify(APPROVED).includes("raw-secret-tok"));
  });
});

describe("SignupTimeline — unknown event", () => {
  it("labels it unrecognized, never 'Other', dumps no metadata", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
    assert.doesNotMatch(body, /\{|\}/);
    assert.doesNotMatch(body, /secret-shop|secret-body|email_body/);
  });
});

describe("SignupTimeline — timezone + reviewer", () => {
  it("renders the timestamp in the TENANT zone; the DATE moves under UTC", () => {
    const a = mount({ initial: page([REJECTED]), timeZone: JLM });
    const b = mount({ initial: page([REJECTED]), timeZone: UTC });
    assert.notEqual(textOf(a), textOf(b));
    assert.ok(textOf(a).includes(formatTenantDateTime(INSTANT, "en", JLM)));
    assert.match(textOf(a), /02:30|2:30/);
    assert.match(textOf(b), /23:30/);
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([APPROVED, REJECTED]) });
    assert.doesNotMatch(textOf(h), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("shows a named reviewer bidi-isolated, and localized former/unknown fallbacks", () => {
    const h = mount({ initial: page([APPROVED, REJECTED, LEGACY]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"));
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });
});

describe("SignupTimeline — pagination + errors", () => {
  it("Load more only when there IS more; appends + dedupes", async () => {
    const none = mount({ initial: page([APPROVED]) });
    assert.equal(loadMoreButton(none), undefined);
    const h = mount({ initial: page([APPROVED, REJECTED], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { cursor: "cur-1" });
    await h.answer(0, { ok: true, page: page([REJECTED, LEGACY]) });
    assert.equal(rows(h).length, 3, "REJECTED not duplicated");
  });

  it("an un-acted click burst cannot fire a second request (ref guard)", () => {
    const h = mount({ initial: page([APPROVED], "cur-1") });
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
    await h.answer(0, { ok: true, page: page([APPROVED]) });
    assert.equal($(h, '[role="alert"]'), null);
    assert.equal(rows(h).length, 1);
  });

  it("a failed load keeps the rows + offers retry; empty is calm", async () => {
    const h = mount({ initial: page([APPROVED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });
    assert.equal(rows(h).length, 1);
    assert.ok(textOf(h).includes(EN.audit.timeline.loadError));
    const empty = mount({ initial: page([]) });
    assert.ok(textOf(empty).includes(EN.audit.timeline.empty));
    assert.equal($(empty, '[role="alert"]'), null);
  });
});

describe("SignupTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no raw value`, () => {
      const dict = getDictionary(locale);
      const h = mount({ initial: page([APPROVED, REJECTED, LEGACY]), locale });
      const body = textOf(h);
      assert.ok(body.includes(dict.audit.signup.events["customer_signup_request.approved"]));
      assert.ok(body.includes(dict.audit.signup.events["customer_signup_request.rejected"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.doesNotMatch(body, /Store signup request approved|Load more/);
      assert.doesNotMatch(body, /raw-secret-tok|applicant@x\.local/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([APPROVED]), locale: "en" });
    assert.ok(textOf(h).includes("Store signup request approved"));
  });
});
