/**
 * M8I.4 — MOUNTED SettingsTimeline INTEGRATION TESTS.
 *
 * Mount the REAL component with a hand-resolved "load more" action. Pins:
 *   • rows render the real M8I.4 events with localized labels + safe details;
 *   • timezone shows the exact stored IANA from → to (never an offset);
 *   • safe scalars/enums render their values; SENSITIVE fields render as a
 *     changed-label only — their old/new value NEVER appears;
 *   • an UNRECOGNIZED event → the explicit unknown label, no raw metadata;
 *   • timestamps render in the TENANT zone; actor fallbacks are localized;
 *   • keyset pagination + ref guard; isolated initial-failure retry; load-more
 *     error retry; calm empty state; ar/he RTL / en LTR.
 *
 * Runner: `npm run test:settings-timeline-ui` (plain tsx — NOT react-server).
 */
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { SettingsTimeline } from "@/components/admin/settings-timeline";
import { getDictionary } from "@/i18n/dictionaries";
import type { SettingsTimelineActionResult } from "@/lib/actions/settings-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  buildSettingsTimelineEvent,
  type SettingsTimelineInitial,
  type SettingsTimelinePage,
} from "@/lib/settings-timeline";
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
  return buildSettingsTimelineEvent({ id, eventType, createdAt, actor, metadata });
}

const BIZ = event("1", "settings.business_updated", {
  changed_fields: ["name_en", "display_vat_rate"],
  display_vat_rate: { from: null, to: 0.18 },
  name_en: { from: "SecretName", to: "SecretName2" }, // sensitive → dropped
});
const TZ = event(
  "2",
  "settings.timezone_changed",
  { changed_fields: ["timezone"], timezone: { from: "Asia/Jerusalem", to: "Europe/London" } },
  FORMER,
);
const TAX = event(
  "3",
  "settings.tax_updated",
  {
    changed_fields: ["legal_name", "default_vat_rate"],
    default_vat_rate: { from: 0.17, to: 0.18 },
    legal_name: { from: "AcmeSecret", to: "AcmeSecret2" }, // sensitive → dropped
  },
  UNKNOWN,
);
const LEGACY = event("4", "settings.bogus", { changed_fields: ["x"] }, UNKNOWN);

const page = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
): SettingsTimelinePage => ({
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
  answer: (i: number, r: SettingsTimelineActionResult) => Promise<void>;
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: SettingsTimelinePage;
  initialFailed?: boolean;
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const requests: { cursor?: string | null }[] = [];
  const deferreds: ReturnType<typeof deferred<SettingsTimelineActionResult>>[] = [];

  const loadMore = (input: { cursor?: string | null }) => {
    requests.push(input);
    const d = deferred<SettingsTimelineActionResult>();
    deferreds.push(d);
    return d.promise;
  };

  const initialProp: SettingsTimelineInitial = opts.initialFailed
    ? { ok: false }
    : { ok: true, page: opts.initial ?? page([]) };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(SettingsTimeline, {
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

describe("SettingsTimeline — rendering the real M8I.4 events", () => {
  it("renders one list item per event with localized titles", () => {
    const h = mount({ initial: page([BIZ, TZ, TAX]) });
    assert.equal(rows(h).length, 3);
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.settings.events["settings.business_updated"]));
    assert.ok(body.includes(EN.audit.settings.events["settings.timezone_changed"]));
    assert.ok(body.includes(EN.audit.settings.events["settings.tax_updated"]));
  });

  it("timezone shows the exact stored IANA from → to (never an offset)", () => {
    const h = mount({ initial: page([TZ]) });
    const body = textOf(h);
    assert.ok(body.includes("Asia/Jerusalem") && body.includes("Europe/London"));
    assert.doesNotMatch(body, /\+0[23]:00|UTC[+-]/);
  });

  it("safe scalars render values; sensitive fields render as a label only", () => {
    const h = mount({ initial: page([BIZ, TAX]) });
    const body = textOf(h);
    assert.ok(body.includes("18%")); // safe display_vat_rate / default_vat_rate
    assert.ok(body.includes(EN.audit.settings.fields.name_en)); // label present
    assert.ok(body.includes(EN.audit.settings.fields.legal_name));
    // The sensitive VALUES never appear.
    assert.doesNotMatch(body, /SecretName|AcmeSecret/);
  });

  it("the event handed to the client carries NO sensitive value key", () => {
    assert.ok(!("name_en" in BIZ.metadata));
    assert.ok(!("legal_name" in TAX.metadata));
    assert.ok(!JSON.stringify(BIZ).includes("SecretName"));
    assert.ok(!JSON.stringify(TAX).includes("AcmeSecret"));
    assert.deepEqual(LEGACY.metadata, {});
  });
});

describe("SettingsTimeline — unknown event", () => {
  it("labels it unrecognized, never 'Other', dumps no metadata", () => {
    const h = mount({ initial: page([LEGACY]) });
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.unknownEvent));
    assert.doesNotMatch(body, /other/i);
    assert.doesNotMatch(body, /\{|\}|changed_fields/);
  });
});

describe("SettingsTimeline — timezone (display) + actor", () => {
  it("renders the timestamp in the TENANT zone; the DATE moves under UTC", () => {
    const a = mount({ initial: page([BIZ]), timeZone: JLM });
    const b = mount({ initial: page([BIZ]), timeZone: UTC });
    assert.notEqual(textOf(a), textOf(b));
    assert.ok(textOf(a).includes(formatTenantDateTime(INSTANT, "en", JLM)));
  });

  it("never prints a raw UTC ISO string", () => {
    const h = mount({ initial: page([BIZ, TZ]) });
    assert.doesNotMatch(textOf(h), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("shows a named actor bidi-isolated, and localized former/unknown fallbacks", () => {
    const h = mount({ initial: page([BIZ, TZ, TAX]) });
    const mono = $$(h, 'span[dir="ltr"]').map((s) => s.textContent);
    assert.ok(mono.includes("owner@madaf.local"));
    const body = textOf(h);
    assert.ok(body.includes(EN.audit.timeline.actorFormer));
    assert.ok(body.includes(EN.audit.timeline.actorUnknown));
  });
});

describe("SettingsTimeline — pagination + errors", () => {
  it("Load more only when there IS more; appends + dedupes", async () => {
    const none = mount({ initial: page([BIZ]) });
    assert.equal(loadMoreButton(none), undefined);
    const h = mount({ initial: page([BIZ, TZ], "cur-1") });
    click(loadMoreButton(h)!);
    assert.deepEqual(h.requests[0], { cursor: "cur-1" });
    await h.answer(0, { ok: true, page: page([TZ, TAX]) });
    assert.equal(rows(h).length, 3, "TZ not duplicated");
  });

  it("an un-acted click burst cannot fire a second request (ref guard)", () => {
    const h = mount({ initial: page([BIZ], "cur-1") });
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
    await h.answer(0, { ok: true, page: page([BIZ]) });
    assert.equal($(h, '[role="alert"]'), null);
    assert.equal(rows(h).length, 1);
  });

  it("a failed load keeps the rows + offers retry; empty is calm", async () => {
    const h = mount({ initial: page([BIZ], "cur-1") });
    click(loadMoreButton(h)!);
    await h.answer(0, { ok: false });
    assert.equal(rows(h).length, 1);
    assert.ok(textOf(h).includes(EN.audit.timeline.loadError));
    const empty = mount({ initial: page([]) });
    assert.ok(textOf(empty).includes(EN.audit.timeline.empty));
    assert.equal($(empty, '[role="alert"]'), null);
  });
});

describe("SettingsTimeline — localization / RTL", () => {
  for (const locale of ["ar", "he"] as const) {
    it(`renders ${locale} with no hardcoded English and no sensitive value`, () => {
      const dict = getDictionary(locale);
      const h = mount({ initial: page([BIZ, TZ, LEGACY]), locale });
      const body = textOf(h);
      assert.ok(body.includes(dict.audit.settings.events["settings.business_updated"]));
      assert.ok(body.includes(dict.audit.settings.events["settings.timezone_changed"]));
      assert.ok(body.includes(dict.audit.unknownEvent));
      assert.doesNotMatch(body, /Business settings updated|Timezone changed|Load more/);
      assert.doesNotMatch(body, /SecretName|AcmeSecret/);
    });
  }

  it("renders en (LTR) with the English strings", () => {
    const h = mount({ initial: page([BIZ]), locale: "en" });
    assert.ok(textOf(h).includes("Business settings updated"));
  });
});
