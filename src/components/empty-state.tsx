import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-surface-warm px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-14 items-center justify-center rounded-card bg-surface-sunken text-ink-muted [&>svg]:size-7 [&>svg]:stroke-[1.5]">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-bold text-ink">{title}</p>
      {hint ? (
        <p className="max-w-[280px] text-[13px] text-ink-muted">{hint}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
