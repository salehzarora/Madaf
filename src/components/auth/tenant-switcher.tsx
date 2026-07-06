"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@/i18n/config";
import { selectTenantAction } from "@/lib/actions/tenant";
import { cn } from "@/lib/utils";

export interface TenantOption {
  id: string;
  name: string;
}

/**
 * Current-tenant indicator + switcher (Supabase mode). Shown only when the
 * user belongs to more than one tenant. Switching verifies membership
 * server-side (selectTenantAction) before the cookie is set.
 */
export function TenantSwitcher({
  locale,
  currentTenantId,
  currentName,
  tenants,
  label,
}: {
  locale: Locale;
  currentTenantId: string;
  currentName: string;
  tenants: TenantOption[];
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(tenantId: string) {
    setOpen(false);
    if (tenantId === currentTenantId) return;
    startTransition(async () => {
      const result = await selectTenantAction({ tenantId, locale });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="flex max-w-48 items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
      >
        <span className="truncate">{currentName}</span>
        <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute z-50 mt-1 max-h-72 w-56 overflow-auto rounded-card border border-line bg-surface p-1 shadow-float end-0"
          >
            {tenants.map((t) => {
              const active = t.id === currentTenantId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-field px-2.5 py-2 text-start text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                      active
                        ? "bg-brand-50 font-semibold text-brand-800"
                        : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
                    )}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-brand-600" : "text-transparent",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
