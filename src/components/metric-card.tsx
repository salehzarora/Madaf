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
    <Card className="flex items-center gap-4 p-5">
      {icon ? (
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-field [&>svg]:size-5",
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
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-muted">{label}</p>
        <p className="text-2xl font-semibold tracking-tight text-ink">
          {value}
        </p>
      </div>
    </Card>
  );
}
