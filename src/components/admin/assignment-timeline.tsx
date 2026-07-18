"use client";

import { Circle, UserMinus, UserPlus, type LucideIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { AssignmentTimelineActionResult } from "@/lib/actions/assignment-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  renderSalesRepAssignmentSource,
  resolveSalesRepAssignmentEventKey,
  safeAssignmentCustomerName,
  safeAssignmentRepEmail,
  salesRepAssignmentAuditEventLabel,
} from "@/lib/sales-rep-assignment-audit";
import type {
  SalesRepAssignmentTimelineEvent,
  SalesRepAssignmentTimelineInitial,
} from "@/lib/sales-rep-assignment-timeline";
import { formatTenantDateTime } from "@/lib/time";

/** The "load more" bridge, INJECTED by the server page. */
export type LoadAssignmentTimeline = (input: {
  cursor?: string | null;
}) => Promise<AssignmentTimelineActionResult>;

/** Icon per event type. Every row ALSO carries its text label, so meaning is
 * never conveyed by icon or color alone. */
const EVENT_ICON: Record<string, LucideIcon> = {
  "sales_rep_assignment.created": UserPlus,
  "sales_rep_assignment.removed": UserMinus,
};

/** Localized, viewer-appropriate actor text (never a raw id). Assignment audit
 * rows are owner/admin-only, so a viewer sees named/former labels. */
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

/** The "by {actor}" attribution. A named actor is an EMAIL, bidi-isolated
 * (dir="ltr" + mono) so its "@"/"." don't reorder inside an RTL sentence. */
function ActorBy({ actor, dict }: { actor: TimelineActor; dict: Dictionary }) {
  const [before, after = ""] = dict.audit.timeline.by.split("{actor}");
  const label = actorText(actor, dict);
  return (
    <span>
      {before}
      {actor.kind === "named" ? (
        <span dir="ltr" className="font-mono break-all">
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
  event: SalesRepAssignmentTimelineEvent;
  locale: Locale;
  dict: Dictionary;
  timeZone: string;
}) {
  const Icon =
    EVENT_ICON[resolveSalesRepAssignmentEventKey(event.eventType) ?? ""] ?? Circle;
  const a = dict.audit.assignment;
  // Bounded snapshots (never a raw UUID); legible even after the member/customer
  // is gone. The source line is already validated + localized.
  const customerName = safeAssignmentCustomerName(event.metadata);
  const repEmail = safeAssignmentRepEmail(event.metadata);
  const source = renderSalesRepAssignmentSource(event, dict);

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
          {salesRepAssignmentAuditEventLabel(event.eventType, dict)}
        </p>
        {customerName ? (
          <p className="mt-0.5 text-xs text-ink-soft">
            <span>{a.customer}</span>
            <span className="mx-1" aria-hidden>
              ·
            </span>
            <span dir="auto" className="break-words text-ink">
              {customerName}
            </span>
          </p>
        ) : null}
        {repEmail ? (
          <p className="mt-0.5 text-xs text-ink-soft">
            <span>{a.representative}</span>
            <span className="mx-1" aria-hidden>
              ·
            </span>
            <span dir="ltr" className="font-mono break-all text-ink">
              {repEmail}
            </span>
          </p>
        ) : null}
        {source ? (
          <p className="mt-0.5 text-xs text-ink-muted">{source}</p>
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
 * Read-only Assignment Activity timeline (M8I.5). Renders the server-fetched
 * initial page and appends older pages through the bounded server action.
 * Tenant-wide (every rep↔customer assignment change); overlapping clicks guarded
 * by a ref; no controls, no raw metadata, and viewing writes nothing.
 *
 * The INITIAL read is optional + isolated on the server (safeInitialAssignmentTimeline):
 *   • { ok: true, page } — render the first page (or the calm empty state);
 *   • { ok: false }      — a localized, RETRYABLE error IN PLACE, without the Team
 *                          management page crashing and WITHOUT faking "no
 *                          activity". A later Load-More failure keeps the rendered
 *                          events and offers a retry.
 */
export function AssignmentTimeline({
  locale,
  dict,
  initial,
  timeZone,
  loadMore,
}: {
  locale: Locale;
  dict: Dictionary;
  initial: SalesRepAssignmentTimelineInitial;
  timeZone: string;
  loadMore: LoadAssignmentTimeline;
}) {
  const t = dict.audit.timeline;
  const [events, setEvents] = useState<SalesRepAssignmentTimelineEvent[]>(
    initial.ok ? initial.page.events : [],
  );
  const [cursor, setCursor] = useState<string | null>(
    initial.ok ? initial.page.nextCursor : null,
  );
  const [hasMore, setHasMore] = useState<boolean>(
    initial.ok ? initial.page.hasMore : false,
  );
  const [initialFailed, setInitialFailed] = useState(!initial.ok);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  const inFlight = useRef(false);

  function onLoadMore() {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setError(false);
    startLoading(async () => {
      try {
        const res = await loadMore({ cursor });
        if (!res.ok || !res.page) {
          setError(true);
          return;
        }
        const page = res.page;
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...page.events.filter((e) => !seen.has(e.id))];
        });
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch {
        setError(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function onRetryInitial() {
    if (inFlight.current) return;
    inFlight.current = true;
    startLoading(async () => {
      try {
        const res = await loadMore({});
        if (!res.ok || !res.page) {
          setInitialFailed(true);
          return;
        }
        const page = res.page;
        setEvents(page.events);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setInitialFailed(false);
      } catch {
        setInitialFailed(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  if (initialFailed) {
    return (
      <div className="flex flex-col">
        <p
          role="alert"
          className="rounded-field bg-surface-sunken px-4 py-6 text-center text-sm font-medium text-danger"
        >
          {t.error}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRetryInitial}
          disabled={loading}
          aria-busy={loading}
          className="mt-3 self-center"
        >
          {loading ? t.loading : t.retry}
        </Button>
      </div>
    );
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
          aria-busy={loading}
          className="mt-3 self-center"
        >
          {loading ? t.loading : t.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
