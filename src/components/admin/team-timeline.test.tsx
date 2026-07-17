/**
 * M8I.3 — MOUNTED TeamTimeline INTEGRATION TESTS.
 *
 * Mount the REAL component with a hand-resolved "load more" action, so pending
 * states, stale replies and overlapping clicks are observable. Pins:
 *   • rows render the real M8I.3 events with localized labels + role details;
 *   • the affected member renders from the target_email SNAPSHOT (bidi-isolated),
 *     never a raw UUID, and stays legible for a removed member;
 *   • a smuggled token/secret value NEVER renders (projection drops it);
 *   • an UNRECOGNIZED event → the explicit unknown label, no raw metadata;
 *   • timestamps render in the TENANT zone; actor fallbacks are localized;
 *   • keyset pagination + ref guard; isolated initial-failure retry; load-more
 *     error retry; calm empty state; ar/he RTL / en LTR.
 *
 * Runner: `npm run test:team-timeline-ui` (plain tsx — NOT react-server).
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { TeamTimeline } from "@/components/admin/team-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { TeamTimelineActionResult } from "@/lib/actions/team-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  buildTeamTimelineEvent,
  type TeamTimelineInitial,
  type TeamTimelinePage,
} from "@/lib/team-timeline";
import { formatTenantDateTime } from "@/lib/time";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
const INSTANT = "2026-07-01T23:30:00Z";

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
  return buildTeamTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const INVITED = event("1", "team.member_invited", {
  target_email: "rep@t.local",
  role: "sales_rep",
});
const ROLE = event(
  "2",
  "team.role_changed",
  {
    target_email: "mgr@t.local",
    from_role: "admin",
    to_role: "owner",
    // A smuggled secret that must NEVER render (projection drops it).
    token: "raw-secret-tok",
    token_hash: "deadbeef",
  },
  FORMER,
);
const REMOVED = event(
  "3",
  "team.member_removed",
  { target_email: "gone@t.local", role: "owner" },
  UNKNOWN,
);
/** Outside the closed catalog carrying a stray key. */
const LEGACY = event("4", "team.member_disabled", { email_body: "secret-body" }, UNKNOWN);

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): TeamTimelinePage => ({
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
  answer: (i: number, r: TeamTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: TeamTimelinePage;
  initialFailed?: boolean;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<TeamTimelineActionResult>>[] = [];

  const loadMore = (input: { cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<TeamTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const initialProp: TeamTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(TeamTimeline, {
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

describe("TeamTimeline — rendering the real M8I.3 events", () => {
  it("renders one list item per event with localized titles", () => {
    const h = mount({ initial: page([INVITED, ROLE, REMOVED]) });
    assert.equal(rows(h).length, 3);
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.team.events["team.member_invited"]));
    assert.ok(body.includes(EN.audit.team.events["team.role_changed"]));
    assert.ok(body.includes(EN.audit.team.events["team.member_removed"]));
  });

  it("shows the affected member from target_email, bidi-isolated (dir=ltr)", () => {
    const h = mount({ initial: page([INVITED, REMOVED]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("rep@t.local"));
    // A removed member's identity remains legible from the snapshot.
    assert.ok(mono.includes("gone@t.local"));
    assert.ok(textOf(h).includes(EN.audit.team.targetMember));
  });

  it("renders localized role details (role line + from→to)", () => {
    const h = mount({ initial: page([INVITED, ROLE]) });
    const body = textOf(h);
    // member_invited → "Role: Sales rep".
    assert.ok(body.includes(EN.access.session.roles.sales_rep));
    // role_changed → "Admin → Owner".
    assert.ok(body.includes(EN.access.session.roles.admin));
    assert.ok(body.includes(EN.access.session.roles.owner));
  });

  it("a smuggled token/secret value NEVER renders", () => {
    const h = mount({ initial: page([ROLE]) });
    const body = textOf(h);
    assert.doesNotMatch(body, /raw-secret-tok|deadbeef/);
    // The event handed to the client carries no secret keys.
    assert.ok(!("token" in ROLE.metadata) && !("token_hash" in ROLE.metadata));
    assert.ok(!JSON.stringify(ROLE).includes("raw-secret-tok"));
  });

  it("never renders a raw UUID for the affected member", () => {
    const h = mount({ initial: page([INVITED, ROLE, REMOVED]) });
    assert.doesNotMatch(textOf(h), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });
});

describe("TeamTimeline — unknown event", () => {
  it("labels it unrecognized, never 'Other', dumps no metadata", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
    assert.doesNotMatch(body, /\{|\}/);
    assert.doesNotMatch(body, /secret-body|email_body/);
  });
});

describe("TeamTimeline — timezone + actor", () => {
  it("renders the timestamp in the TENANT zone; the DATE moves under UTC", () => {
    const a = mount({ initial: page([INVITED]), timeZone: JLM });
    const b = mount({ initial: page([INVITED]), timeZone: UTC });
    assert.notEqual(textOf(a), textOf(b));
    assert.ok(textOf(a).includes(formatTenantDateTime(INSTANT, "en", JLM)));
    assert.match(textOf(a), /02:30|2:30/);
    assert.match(textOf(b), /23:30/);
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([INVITED, ROLE]) });
    assert.doesNotMatch(textOf(h), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("shows a named actor bidi-isolated, and localized former/unknown fallbacks", () => {
    const h = mount({ initial: page([INVITED, ROLE, REMOVED]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"));
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });
});

describe("TeamTimeline — pagination + errors", () => {
  it("Load more only when there IS more; appends + dedupes", async () => {
    const none = mount({ initial: page([INVITED]) });
    assert.equal(loadMoreButton(none), undefined);
    const h = mount({ initial: page([INVITED, ROLE], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { cursor: "cur-1" });
    await h.answer(0, { ok: true, page: page([ROLE, REMOVED]) });
    assert.equal(rows(h).length, 3, "ROLE not duplicated");
  });

  it("an un-acted click burst cannot fire a second request (ref guard)", () => {
    const h = mount({ initial: page([INVITED], "cur-1") });
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
    await h.answer(0, { ok: true, page: page([INVITED]) });
    assert.equal($(h, '[role="alert"]'), null);
    assert.equal(rows(h).length, 1);
  });

  it("a failed load keeps the rows + offers retry; empty is calm", async () => {
    const h = mount({ initial: page([INVITED], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });
    assert.equal(rows(h).length, 1);
    assert.ok(textOf(h).includes(EN.audit.timeline.loadError));
    const empty = mount({ initial: page([]) });
    assert.ok(textOf(empty).includes(EN.audit.timeline.empty));
    assert.equal($(empty, '[role="alert"]'), null);
  });
});

describe("TeamTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no raw value`, () => {
      const dict = getDictionary(locale);
      const h = mount({ initial: page([INVITED, ROLE, LEGACY]), locale });
      const body = textOf(h);
      assert.ok(body.includes(dict.audit.team.events["team.member_invited"]));
      assert.ok(body.includes(dict.audit.team.events["team.role_changed"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.doesNotMatch(body, /Member invited|Role changed|Load more/);
      assert.doesNotMatch(body, /raw-secret-tok|email_body/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([INVITED]), locale: "en" });
    assert.ok(textOf(h).includes("Member invited"));
  });
});
