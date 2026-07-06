import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

// Squared "ticket" badges: tone-soft fill, tone text, current-color border.
const tones: Record<Tone, string> = {
  neutral: "bg-background text-ink-soft border-line",
  brand: "bg-brand-50 text-brand-700 border-brand-600/25",
  success: "bg-success-soft text-success border-current/25",
  warning: "bg-warning-soft text-warning border-current/25",
  danger: "bg-danger-soft text-danger border-current/25",
  info: "bg-info-soft text-info border-current/25",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Render a leading square dot in the current tone. */
  dot?: boolean;
  /** Dashed border — used by every invoice-draft badge. */
  dashed?: boolean;
}

export function Badge({
  tone = "neutral",
  dot = false,
  dashed = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-[3px] text-xs font-semibold",
        dashed && "border-dashed",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className="size-1.5 rounded-[2px] bg-current" aria-hidden />
      ) : null}
      {children}
    </span>
  );
}
