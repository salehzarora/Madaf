import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** SaaS-dashboard stat tile. */
export function MetricCard({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: "default" | "warning" | "brand";
}) {
  return (
    <Card
      className={cn(
        "p-4.5",
        tone === "warning" && "border-warning/35 bg-accent-wash",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "text-[11px] font-bold uppercase tracking-[0.08em]",
            tone === "warning" ? "text-warning" : "text-ink-muted",
          )}
        >
          {label}
        </p>
        {icon ? (
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4",
              tone === "warning"
                ? "bg-warning-soft text-warning"
                : tone === "brand"
                  ? "bg-brand-50 text-brand-700"
                  : "bg-surface-sunken text-ink-soft",
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-[32px] font-extrabold tabular-nums tracking-[-0.02em] text-ink">
        {value}
      </p>
    </Card>
  );
}
