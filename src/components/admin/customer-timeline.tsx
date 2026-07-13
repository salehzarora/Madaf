"use client";

import {
  Circle,
  Link2,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  ShoppingBag,
  Unlink,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { loadCustomerTimelineAction } from "@/lib/actions/customer-timeline";
import {
  auditEventLabel,
  renderCustomerAuditDetails,
  resolveCustomerEventKey,
} from "@/lib/audit-events";
import type { TimelineActor, TimelineEvent, TimelinePage } from "@/lib/customer-timeline";
import { formatTenantDateTime } from "@/lib/time";

/** Icon per event type — every event ALSO carries a text label, so meaning is
 * never conveyed by icon/color alone. */
const EVENT_ICON: Record<string, LucideIcon> = {
  "customer.created": UserPlus,
  "customer.updated": Pencil,
  "customer.activated": Power,
  "customer.deactivated": PowerOff,
  "customer.access_link.created": Link2,
  "customer.access_link.rotated": RefreshCw,
  "customer.access_link.revoked": Unlink,
  "customer.order_linked": ShoppingBag,
};

/** Localized, viewer-appropriate actor text (never a raw id or leaked email). */
function actorText(actor: TimelineActor, dict: Dictionary): string {
  switch (actor.kind) {
    case "named":
      return actor.label;
    case "member":
      return dict.audit.timeline.actorMember;
    case "former":
      return dict.audit.timeline.actorFormer;
    case "unknown":
      return dict.audit.timeline.actorUnknown;
  }
}

/** The "by {actor}" attribution. A named actor is an EMAIL, so it is bidi-
 * isolated (dir="ltr" + mono) — otherwise the "@" / "." reorder inside an RTL
 * sentence. Other kinds are localized text and render inline. Splitting the
 * template (not string interpolation) keeps the isolation an element, so the
 * surrounding ar/he sentence stays correct. */
function ActorBy({ actor, dict }: { actor: TimelineActor; dict: Dictionary }) {
  const [before, after = ""] = dict.audit.timeline.by.split("{actor}");
  const label = actorText(actor, dict);
  return (
    <span>
      {before}
      {actor.kind === "named" ? (
        <span dir="ltr" className="font-mono">
          {label}
        </span>
      ) : (
        label
      )}
      {after}
    </span>
  );
}

function TimelineRow({
  event,
  locale,
  dict,
  timeZone,
}: {
  event: TimelineEvent;
  locale: Locale;
  dict: Dictionary;
  timeZone: string;
}) {
  const Icon = EVENT_ICON[resolveCustomerEventKey(event.eventType) ?? ""] ?? Circle;
  const details = renderCustomerAuditDetails(event, dict);
  return (
    <li className="flex gap-3 py-3">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-soft"
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {auditEventLabel(event.eventType, dict)}
        </p>
        {details.length > 0 ? (
          <p className="mt-0.5 text-xs text-ink-soft">{details.join(" · ")}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-ink-muted">
          <span>{formatTenantDateTime(event.createdAt, locale, timeZone)}</span>
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          <ActorBy actor={event.actor} dict={dict} />
        </p>
      </div>
    </li>
  );
}

/**
 * Read-only Customer Timeline (M8G.3). Renders the server-fetched initial page
 * and appends older pages via the bounded server action. State is fully
 * Customer-scoped (a fresh component per customer id via the page); overlapping
 * "load more" clicks are guarded; a failed load keeps the rendered events and
 * offers a retry. No edit/delete controls, no raw metadata.
 */
export function CustomerTimeline({
  customerId,
  locale,
  dict,
  initialPage,
  timeZone,
}: {
  customerId: string;
  locale: Locale;
  dict: Dictionary;
  initialPage: TimelinePage;
  /** M8H.2 — the tenant's IANA zone (server-derived). Audit rows are absolute
   * UTC instants; they are DISPLAYED in the business's timezone. */
  timeZone: string;
}) {
  const t = dict.audit.timeline;
  const [events, setEvents] = useState<TimelineEvent[]>(initialPage.events);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [hasMore, setHasMore] = useState<boolean>(initialPage.hasMore);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  // A ref guard so overlapping clicks (or a click while the transition is
  // pending) never fire a second concurrent request.
  const inFlight = useRef(false);

  function onLoadMore() {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setError(false);
    startLoading(async () => {
      const res = await loadCustomerTimelineAction({ customerId, cursor });
      inFlight.current = false;
      if (!res.ok || !res.page) {
        setError(true); // keep already-rendered events; offer retry
        return;
      }
      const seen = new Set(events.map((e) => e.id));
      const fresh = res.page.events.filter((e) => !seen.has(e.id));
      setEvents((prev) => [...prev, ...fresh]);
      setCursor(res.page.nextCursor);
      setHasMore(res.page.hasMore);
    });
  }

  if (events.length === 0) {
    return (
      <div className="rounded-field bg-surface-sunken px-4 py-6 text-center">
        <p className="text-sm font-medium text-ink-soft">{t.empty}</p>
        <p className="mt-1 text-xs text-ink-muted">{t.emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ol className="divide-y divide-line-hair">
        {events.map((event) => (
          <TimelineRow
            key={event.id}
            event={event}
            locale={locale}
            dict={dict}
            timeZone={timeZone}
          />
        ))}
      </ol>

      {error ? (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 text-xs font-medium text-danger"
        >
          {t.loadError}
          <button
            type="button"
            onClick={onLoadMore}
            className="font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {t.retry}
          </button>
        </p>
      ) : null}

      {hasMore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={loading}
          className="mt-3 self-center"
        >
          {loading ? t.loading : t.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
