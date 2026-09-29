"use client";
import { useState, useTransition } from "react";
import { BellRing, Boxes, ShoppingBag, Store } from "lucide-react";
import type { Dictionary } from "@/i18n/types";
import { Button } from "@/components/ui/button";
import { savePushPreferencesAction } from "@/lib/actions/push-preferences";
import { preferenceKeys, type PushPreferences } from "@/lib/push/preferences";

const icons = { new_order: ShoppingBag, signup_request: Store, low_stock: Boxes, order_status: BellRing };
export function NotificationSettings({ initial, text, live, scope }: {
  initial: PushPreferences; text: Dictionary["notificationSettings"]; live: boolean; scope: string;
}) {
  const [value, setValue] = useState(initial);
  const [result, setResult] = useState<"saved" | "error" | null>(null);
  const [pending, startTransition] = useTransition();
  function save() {
    setResult(null);
    startTransition(async () => {
      try { setResult((await savePushPreferencesAction(value, scope)).ok ? "saved" : "error"); }
      catch { setResult("error"); }
    });
  }
  return (
    <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); save(); }}>
      {!live && <p className="rounded-field bg-info-soft p-3 text-sm text-[var(--admin-muted)]">{text.demo}</p>}
      {preferenceKeys.map(key => {
        const Icon = icons[key];
        return <div key={key} className="flex min-w-0 items-center gap-3 rounded-card border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-card sm:p-5">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-field bg-[var(--admin-cyan)] text-[var(--admin-emerald)]"><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <label htmlFor={`notification-${key}`} className="cursor-pointer text-sm font-bold text-[var(--admin-navy)]">{text[key].title}</label>
            <p id={`notification-${key}-description`} className="mt-1 text-xs leading-relaxed text-[var(--admin-muted)]">{text[key].description}</p>
          </div>
          <button id={`notification-${key}`} type="button" role="switch" aria-checked={value[key]}
            aria-label={text[key].title} aria-describedby={`notification-${key}-description`} disabled={pending || !live}
            onClick={() => { setValue(current => ({ ...current, [key]: !current[key] })); setResult(null); }}
            className="flex h-11 w-12 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50">
            <span className={`flex h-7 w-12 items-center rounded-full border p-0.5 transition-colors ${value[key] ? "justify-end border-[var(--admin-emerald)] bg-[var(--admin-emerald)]" : "justify-start border-[var(--admin-border)] bg-[var(--admin-canvas)]"}`}>
              <span className="size-5 rounded-full bg-white shadow-sm" />
            </span>
          </button>
        </div>;
      })}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !live}>{pending ? text.saving : text.save}</Button>
        <p role={result === "error" ? "alert" : "status"} aria-live="polite" className={`text-sm ${result === "error" ? "text-danger" : "text-[var(--admin-emerald)]"}`}>
          {result ? text[result] : ""}
        </p>
      </div>
    </form>
  );
}
