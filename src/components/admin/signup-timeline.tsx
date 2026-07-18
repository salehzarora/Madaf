"use client";

import { Ban, Circle, UserCheck, type LucideIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { SignupTimelineActionResult } from "@/lib/actions/signup-timeline";
import type { TimelineActor } from "@/lib/customer-timeline";
import {
  resolveSignupRequestEventKey,
  safeSignupBusinessName,
  safeSignupResultingCustomerId,
  signupRequestAuditEventLabel,
} from "@/lib/signup-request-audit";
import type {
  SignupRequestTimelineEvent,
  SignupRequestTimelineInitial,
} from "@/lib/signup-request-timeline";
import { formatTenantDateTime } from "@/lib/time";

/** The "load more" bridge, INJECTED by the server page. */
export type LoadSignupTimeline = (input: {
  cursor?: string | null;
}) => Promise<SignupTimelineActionResult>;

/** Icon per event type. Every row ALSO carries its text label, so meaning is
 * never conveyed by icon or color alone. */
const EVENT_ICON: Record<string, LucideIcon> = {
  "customer_signup_request.approved": UserCheck,
  "customer_signup_request.rejected": Ban,
};

/** Localized, viewer-appropriate reviewer text (never a raw id). Signup audit rows
 * are owner/admin-only, so a viewer sees named/former labels. */
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

/** The "by {actor}" attribution (the reviewer). A named actor is an EMAIL,
 * bidi-isolated (dir="ltr" + mono) so its "@"/"." don't reorder in an RTL line. */
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

/** The business-name snapshot — plain text, or (approved, with a valid resulting
 * customer id) a link to that Customer. The visible label is always the business
 * name; the raw Customer UUID is never shown (only in the href). */
function BusinessLabel({
  event,
  locale,
  dict,
}: {
  event: SignupRequestTimelineEvent;
  locale: Locale;
  dict: Dictionary;
}) {
  const name = safeSignupBusinessName(event.metadata);
  if (!name) return null;
  const customerId = safeSignupResultingCustomerId(event.metadata);
  if (customerId) {
    return (
      <a
        href={`/${locale}/admin/customers/${customerId}`}
        dir="auto"
        title={dict.audit.signup.resultingCustomer}
        className="break-words font-medium text-brand-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {name}
      </a>
    );
  }
  return (
    <span dir="auto" className="break-words text-ink">
      {name}
    </span>
  );
}

function TimelineRow({
  event,
  locale,
  dict,
  timeZone,
}: {
  event: SignupRequestTimelineEvent;
  locale: Locale;
  dict: Dictionary;
  timeZone: string;
}) {
  const Icon =
    EVENT_ICON[resolveSignupRequestEventKey(event.eventType) ?? ""] ?? Circle;

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
          {signupRequestAuditEventLabel(event.eventType, dict)}
        </p>
        {safeSignupBusinessName(event.metadata) ? (
          <p className="mt-0.5 text-xs text-ink-soft">
            <span>{dict.audit.signup.business}</span>
            <span className="mx-1" aria-hidden>
              ·
            </span>
            <BusinessLabel event={event} locale={locale} dict={dict} />
          </p>
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
 * Read-only Customer Signup Activity timeline (M8I.6). Renders the server-fetched
 * initial page and appends older pages through the bounded server action.
 * Tenant-wide (every approve/reject decision); overlapping clicks guarded by a
 * ref; no controls, no raw metadata, no applicant contact data, and viewing writes
 * nothing.
 *
 * The INITIAL read is optional + isolated on the server (safeInitialSignupTimeline):
 *   • { ok: true, page } — render the first page (or the calm empty state);
 *   • { ok: false }      — a localized, RETRYABLE error IN PLACE, without the signup
 *                          management page crashing and WITHOUT faking "no
 *                          activity". A later Load-More failure keeps the rendered
 *                          rows and offers a retry.
 */
export function SignupTimeline({
  locale,
  dict,
  initial,
  timeZone,
  loadMore,
}: {
  locale: Locale;
  dict: Dictionary;
  initial: SignupRequestTimelineInitial;
  timeZone: string;
  loadMore: LoadSignupTimeline;
}) {
  const t = dict.audit.timeline;
  const [events, setEvents] = useState<SignupRequestTimelineEvent[]>(
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
