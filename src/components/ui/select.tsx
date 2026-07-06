import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Native <select> in a ledger field wrapper — a squared field with a chevron
 * cap. Native keeps the option list accessible and RTL-correct for free; the
 * chevron sits at the logical end (`inset-inline-end`).
 */
export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative inline-flex">
      <select
        className={cn(
          "h-10 appearance-none rounded-field border border-line-strong bg-surface pe-9 ps-3.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink focus:border-brand-600 focus:outline-none focus:ring-[3px] focus:ring-brand-600/15",
          className,
        )}
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
    </div>
  );
}
