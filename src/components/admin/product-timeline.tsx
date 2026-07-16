"use client";

import {
  Circle,
  Eye,
  EyeOff,
  Package,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { ProductTimelineActionResult } from "@/lib/actions/product-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  productAuditEventLabel,
  renderProductAuditDetails,
  resolveProductEventKey,
} from "@/lib/product-audit";
import type {
  ProductTimelineEvent,
  ProductTimelineInitial,
} from "@/lib/product-timeline";
import { formatTenantDateTime } from "@/lib/time";

/** The "load more" bridge, INJECTED by the server page. Keeping it a prop (a)
 * matches the order/customer timeline seam and (b) lets the mounted tests drive
 * real component behavior without a server runtime. */
export type LoadProductTimeline = (input: {
  productId: string;
  cursor?: string | null;
}) => Promise<ProductTimelineActionResult>;

/** Icon per event type. Every row ALSO carries its text label, so meaning is
 * never conveyed by icon or color alone. */
const EVENT_ICON: Record<string, LucideIcon> = {
  "product.created": Package,
  "product.updated": Pencil,
  "product.activated": Eye,
  "product.deactivated": EyeOff,
};

/** Localized, viewer-appropriate actor text (never a raw id, never a leaked
 * email). A NULL actor is "unknown user". Product audit rows are owner/admin-only,
 * so a viewer here always sees named/former labels. */
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
 * isolated (dir="ltr" + mono) — otherwise its "@" / "." reorder inside an RTL
 * sentence. Splitting the template keeps the isolation an ELEMENT, so the
 * surrounding ar/he sentence stays correct. */
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
  event: ProductTimelineEvent;
  locale: Locale;
  dict: Dictionary;
  timeZone: string;
}) {
  // An unrecognized event type gets the neutral marker + the explicit
  // "unrecognized event" label; its metadata was already projected away.
  const Icon = EVENT_ICON[resolveProductEventKey(event.eventType) ?? ""] ?? Circle;
  const details = renderProductAuditDetails(event, dict);

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
          {productAuditEventLabel(event.eventType, dict)}
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
 * Read-only Product Timeline (M8I.1). Renders the server-fetched initial page and
 * appends older pages through the bounded server action. State is Product-scoped
 * (a fresh component per product id via the page); overlapping clicks are guarded
 * by a ref; no edit/delete controls, no raw metadata, and viewing writes nothing.
 *
 * The INITIAL read is optional and isolated on the server (safeInitialProductTimeline),
 * so it arrives as a discriminated `initial`:
 *   • { ok: true, page } — render the first page (or the calm empty state);
 *   • { ok: false }      — render a localized, RETRYABLE error IN PLACE, without
 *                          the Product edit page ever crashing and WITHOUT faking
 *                          "no activity". Retry performs a fresh first-page read
 *                          through the SAME bounded action; on success it replaces
 *                          the error with the real page, on failure it stays a
 *                          contained, still-retryable error.
 * A later Load-More failure instead KEEPS the already-rendered events and offers a
 * retry, so a Timeline failure never blanks the Product edit form around it.
 */
export function ProductTimeline({
  productId,
  locale,
  dict,
  initial,
  timeZone,
  loadMore,
}: {
  productId: string;
  locale: Locale;
  dict: Dictionary;
  /** The isolated initial read result (success carries the first page; failure
   * is explicit so the section can offer a retry instead of crashing the page). */
  initial: ProductTimelineInitial;
  /** The tenant's IANA zone (server-derived). Audit rows are absolute UTC
   * instants; they are DISPLAYED in the business's timezone. */
  timeZone: string;
  loadMore: LoadProductTimeline;
}) {
  const t = dict.audit.timeline;
  const [events, setEvents] = useState<ProductTimelineEvent[]>(
    initial.ok ? initial.page.events : [],
  );
  const [cursor, setCursor] = useState<string | null>(
    initial.ok ? initial.page.nextCursor : null,
  );
  const [hasMore, setHasMore] = useState<boolean>(
    initial.ok ? initial.page.hasMore : false,
  );
  // The initial server read failed → show a retryable error IN PLACE (never the
  // empty state, which would falsely claim "no activity").
  const [initialFailed, setInitialFailed] = useState(!initial.ok);
  // A Load-More failure while events are already shown (distinct from the initial
  // failure above).
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  // A ref guard so overlapping clicks can never fire a second concurrent request
  // — which is what would otherwise duplicate a page.
  const inFlight = useRef(false);

  function onLoadMore() {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setError(false);
    startLoading(async () => {
      try {
        const res = await loadMore({ productId, cursor });
        if (!res.ok || !res.page) {
          setError(true); // keep the rendered events; offer a retry
          return;
        }
        const page = res.page;
        // Dedupe by audit id: a stale/duplicated reply can never insert a row
        // twice, even though the keyset predicate already excludes it.
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...page.events.filter((e) => !seen.has(e.id))];
        });
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch {
        // A TRANSPORT-level rejection (network drop, or a Server-Action failure
        // that never reached the action's own try/catch) rejects the promise
        // rather than resolving { ok: false }. Treat it identically: surface the
        // retry, keep the rendered rows, and release the in-flight guard below.
        setError(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  // Retry the INITIAL read: a fresh FIRST page (no cursor) through the same
  // bounded action + safe projection the SSR path used.
  function onRetryInitial() {
    if (inFlight.current) return;
    inFlight.current = true;
    startLoading(async () => {
      try {
        const res = await loadMore({ productId }); // no cursor → first page
        if (!res.ok || !res.page) {
          setInitialFailed(true); // still failed; remain retryable
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

  // Initial read failed: a localized, retryable error IN PLACE — never the empty
  // state, and the surrounding Product edit page is fully rendered around this.
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
