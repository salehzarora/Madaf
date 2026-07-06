import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Dashboard v2 KPI card: eyebrow + big tabular value + an optional extra
 * (chip / mini-bar / sparkline) and sub-line supplied as children. */
export function KpiCard({
  label,
  value,
  tone = "default",
  children,
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
  children?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "p-4.5",
        tone === "warning" && "border-warning/35 bg-accent-wash",
      )}
    >
      <p
        className={cn(
          "text-[11px] font-bold uppercase tracking-[0.08em]",
          tone === "warning" ? "text-warning" : "text-ink-muted",
        )}
      >
        {label}
      </p>
      <p className="mt-1.5 text-[30px] font-extrabold tabular-nums tracking-[-0.02em] text-ink">
        {value}
      </p>
      {children ? <div className="mt-2">{children}</div> : null}
    </Card>
  );
}
