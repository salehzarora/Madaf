"use client";

import { ChevronDown, Languages } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { persistLocale } from "@/i18n/locale-preference";
import { cn } from "@/lib/utils";

type LocaleSwitcherProps = {
  current: Locale;
  className?: string;
  variant?: "segmented" | "compact";
  label?: string;
};

/** Keep query-dependent rendering inside this leaf's Suspense boundary. */
export function LocaleSwitcher(props: LocaleSwitcherProps) {
  return (
    <Suspense fallback={<LocaleSwitcherControls {...props} query="" />}>
      <LocaleSwitcherWithQuery {...props} />
    </Suspense>
  );
}

function LocaleSwitcherWithQuery(props: LocaleSwitcherProps) {
  const query = useSearchParams()?.toString() ?? "";
  return <LocaleSwitcherControls {...props} query={query} />;
}

function LocaleSwitcherControls({
  current,
  className,
  variant = "segmented",
  label = "Language",
  query,
}: LocaleSwitcherProps & { query: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLAnchorElement>("a[aria-current]")?.focus();
    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function hrefFor(target: Locale): string {
    const rest = pathname.replace(/^\/(ar|he|en)(?=\/|$)/, "");
    return `/${target}${rest}${query ? `?${query}` : ""}`;
  }

  if (variant === "compact") {
    return (
      <div
        ref={rootRef}
        className={cn("relative", className)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${label}: ${localeNames[current]}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((previous) => !previous)}
          className="inline-flex h-11 items-center gap-1 rounded-field border border-line px-2.5 text-xs font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <Languages className="size-4" aria-hidden />
          <span lang={current}>{localeNames[current]}</span>
          <ChevronDown className="size-3" aria-hidden />
        </button>
        {open ? (
          <nav
            ref={panelRef}
            id={panelId}
            aria-label={label}
            className="absolute end-0 top-full z-50 mt-1 w-40 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-1 shadow-float"
          >
            {locales.map((locale) => (
              <Link
                key={locale}
                href={hrefFor(locale)}
                lang={locale}
                aria-current={locale === current ? "true" : undefined}
                onClick={() => { persistLocale(locale); setOpen(false); }}
                className={cn(
                  "flex min-h-11 items-center rounded-field px-3 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600",
                  locale === current ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:bg-surface-warm",
                )}
              >
                {localeNames[locale]}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    );
  }

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex items-center rounded-full border border-line bg-surface-sunken p-1",
        className,
      )}
    >
      {locales.map((locale) => (
        <Link
          key={locale}
          href={hrefFor(locale)}
          onClick={() => persistLocale(locale)}
          aria-current={locale === current ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            locale === current
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {localeNames[locale]}
        </Link>
      ))}
    </nav>
  );
}
