"use client";

/**
 * Tenant timezone control (M8H.2) — owner/admin only (the settings route already
 * blocks sales_rep, so this never renders for them).
 *
 * Saves an IANA name explicitly. It deliberately does NOT auto-save the device's
 * timezone: the browser zone is shown only as a non-authoritative hint, because
 * a business's times must not change just because someone travelled or opened the
 * admin from another country. Fixed offsets (+03:00) are not offered at all —
 * they cannot express daylight saving.
 */
import { useMemo, useState, useTransition } from "react";
import { Check, Globe, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { interpolate } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { updateTenantTimeZoneAction } from "@/lib/actions/tenant-timezone";
import { cn } from "@/lib/utils";

type Status = "idle" | "saved" | "invalid" | "forbidden" | "failed";

export function TimezoneSettings({
  locale,
  dict,
  current,
  options,
  live,
}: {
  locale: Locale;
  dict: Dictionary;
  /** The tenant's persisted IANA zone. */
  current: string;
  /** Canonical IANA names, computed on the SERVER (no browser API dependency,
   * no query, and every one is accepted by the database). */
  options: readonly string[];
  /** Supabase mode persists; mock is a demo (nothing is saved). */
  live: boolean;
}) {
  const t = dict.admin.settings.business.timezone;
  const [selected, setSelected] = useState(current);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [saving, startSaving] = useTransition();

  // A purely informational hint. It is NEVER auto-applied.
  const deviceZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  // The tenant's CURRENT zone is always offered, even if this runtime's catalog
  // doesn't list that exact spelling. PostgreSQL accepts IANA's full set including
  // backward-compat aliases, while ICU reports only its own canonical names (it
  // says `Asia/Katmandu`, IANA says `Asia/Kathmandu`) — so a perfectly valid stored
  // zone can be absent from the picker. Without this, an owner would open Settings
  // and not see their own timezone in the list.
  const offered = useMemo(
    () => (options.includes(current) ? options : [current, ...options]),
    [options, current],
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? offered.filter((z) => z.toLowerCase().includes(q)) : offered;
    return list.slice(0, 40); // bounded render; refine with search
  }, [offered, search]);

  const dirty = selected !== current;

  function onSave() {
    if (!dirty || saving) return;
    setStatus("idle");
    startSaving(async () => {
      if (!live) {
        // Mock demo: nothing persists (mirrors the business profile form).
        setStatus("saved");
        return;
      }
      const res = await updateTenantTimeZoneAction({ timezone: selected, locale });
      setStatus(res.ok ? "saved" : (res.error ?? "failed"));
    });
  }

  const errorText =
    status === "invalid"
      ? t.errorInvalid
      : status === "forbidden"
        ? t.errorForbidden
        : status === "failed"
          ? t.errorFailed
          : null;

  return (
    <section aria-labelledby="tz-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-ink-muted" aria-hidden />
        <h2
          id="tz-heading"
          className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted"
        >
          {t.section}
        </h2>
      </div>

      <p className="text-sm text-ink-soft">{t.help}</p>
      <p className="text-xs text-ink-muted">{t.historyNote}</p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">{t.current}:</span>
        <span
          dir="ltr"
          className="rounded-field bg-surface-sunken px-2 py-1 font-mono text-[13px] font-semibold text-ink"
        >
          {current}
        </span>
      </div>

      <label htmlFor="tz-search" className="sr-only">
        {t.searchPlaceholder}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-ink-muted start-3"
          aria-hidden
        />
        <input
          id="tz-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="h-10 w-full rounded-field border border-line-strong bg-surface ps-9 pe-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
      </div>

      <div
        role="radiogroup"
        aria-labelledby="tz-heading"
        className="max-h-64 overflow-y-auto rounded-field border border-line"
      >
        {matches.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-muted">{t.noMatches}</p>
        ) : (
          <ul className="divide-y divide-line-hair">
            {matches.map((zone) => {
              const isSelected = zone === selected;
              return (
                <li key={zone}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(zone)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-start transition-colors",
                      isSelected
                        ? "bg-brand-50 text-brand-800"
                        : "hover:bg-surface-warm",
                    )}
                  >
                    <span dir="ltr" className="font-mono text-[13px]">
                      {zone}
                    </span>
                    {isSelected ? (
                      <Check className="size-4 shrink-0" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {deviceZone && deviceZone !== current ? (
        <p className="text-xs text-ink-muted">
          {interpolate(t.deviceHint, { zone: deviceZone })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onSave} disabled={!dirty || saving}>
          {saving ? t.saving : t.save}
        </Button>
        {status === "saved" ? (
          <p role="status" className="text-sm font-medium text-success">
            {t.saved}
          </p>
        ) : null}
        {errorText ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errorText}
          </p>
        ) : null}
      </div>
    </section>
  );
}
