"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Package quantity stepper — big touch targets for tablet use in shops.
 * Controlled: parent owns the value (usually the cart).
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  size = "md",
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const btn =
    size === "sm"
      ? "size-9"
      : "size-11";

  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-field border border-line-strong bg-surface-warm",
        className,
      )}
    >
      <button
        type="button"
        aria-label="−"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={cn(
          btn,
          "flex items-center justify-center rounded-s-field text-ink-soft transition-colors hover:bg-surface-sunken disabled:opacity-35",
        )}
      >
        <Minus className="size-4" />
      </button>
      <span
        className={cn(
          "min-w-9 text-center font-mono text-sm font-semibold tabular-nums",
          value > 0 ? "text-ink" : "text-ink-muted",
        )}
        dir="ltr"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="+"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className={cn(
          btn,
          "flex items-center justify-center rounded-e-field text-ink-soft transition-colors hover:bg-surface-sunken disabled:opacity-35",
        )}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
