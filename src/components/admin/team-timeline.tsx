"use client";

import {
  Ban,
  Circle,
  Shield,
  UserCheck,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { TeamTimelineActionResult } from "@/lib/actions/team-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  renderTeamAuditDetails,
  resolveTeamEventKey,
  safeTeamTargetEmail,
  teamAuditEventLabel,
} from "@/lib/team-audit";
import type {
  TeamTimelineEvent,
  TeamTimelineInitial,
} from "@/lib/team-timeline";
import { formatTenantDateTime } from "@/lib/time";

/** The "load more" bridge, INJECTED by the server page (matches the other
 * timelines' seam; lets the mounted tests drive real behavior). */
export type LoadTeamTimeline = (input: {
  cursor?: string | null;
}) => Promise<TeamTimelineActionResult>;

/** Icon per event type. Every row ALSO carries its text label, so meaning is
 * never conveyed by icon or color alone. */
const EVENT_ICON: Record<string, LucideIcon> = {
  "team.member_invited": UserPlus,
  "team.invitation_revoked": Ban,
  "team.member_joined": UserCheck,
  "team.role_changed": Shield,
  "team.member_removed": UserMinus,
};

/** Localized, viewer-appropriate actor text (never a raw id, never a leaked
 * email). Team audit rows are owner/admin-only, so a viewer sees named/former
 * labels. */
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
  event: TeamTimelineEvent;
  locale: Locale;
  dict: Dictionary;
  timeZone: string;
}) {
  const Icon = EVENT_ICON[resolveTeamEventKey(event.eventType) ?? ""] ?? Circle;
  // Detail lines are already validated + localized (safe role enums only).
  const details = renderTeamAuditDetails(event, dict);
  // The affected member is the bounded target_email snapshot — never a raw UUID,
  // and it stays legible even after the member is removed.
  const target = safeTeamTargetEmail(event.metadata);

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
          {teamAuditEventLabel(event.eventType, dict)}
        </p>
        {target ? (
          <p className="mt-0.5 text-xs text-ink-soft">
            <span>{dict.audit.team.targetMember}</span>
            <span className="mx-1" aria-hidden>
              ·
            </span>
            <span dir="ltr" className="font-mono break-all text-ink">
              {target}
            </span>
          </p>
        ) : null}
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
 * Read-only Team Activity timeline (M8I.3). Renders the server-fetched initial
 * page and appends older pages through the bounded server action. Tenant-wide
 * (invitations + memberships); overlapping clicks guarded by a ref; no controls,
 * no raw metadata, and viewing writes nothing.
 *
 * The INITIAL read is optional + isolated on the server (safeInitialTeamTimeline):
 *   • { ok: true, page } — render the first page (or the calm empty state);
 *   • { ok: false }      — a localized, RETRYABLE error IN PLACE, without the Team
 *                          management page crashing and WITHOUT faking "no
 *                          activity". A later Load-More failure keeps the rendered
 *                          events and offers a retry.
 */
export function TeamTimeline({
  locale,
  dict,
  initial,
  timeZone,
  loadMore,
}: {
  locale: Locale;
  dict: Dictionary;
  initial: TeamTimelineInitial;
  timeZone: string;
  loadMore: LoadTeamTimeline;
}) {
  const t = dict.audit.timeline;
  const [events, setEvents] = useState<TeamTimelineEvent[]>(
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
