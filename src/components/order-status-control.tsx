"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { OrderStatusBadge } from "@/components/order-status-badge";
import type { Dictionary } from "@/i18n/types";
import type { OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Visual order-status pipeline for the admin order detail.
 * Demo behavior: state is local only and resets on reload (by design —
 * there is no backend in this phase).
 */
export function OrderStatusControl({
  initialStatus,
  dict,
}: {
  initialStatus: OrderStatus;
  dict: Dictionary;
}) {
  const [status, setStatus] = useState<OrderStatus>(initialStatus);

  const pipeline: OrderStatus[] = ["new", "confirmed", "preparing", "delivered"];
  const currentIndex = pipeline.indexOf(status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <OrderStatusBadge status={status} dict={dict.status} />
        <p className="text-xs text-ink-muted">
          {dict.admin.orders.detail.statusHint}
        </p>
      </div>

      {/* Pipeline steps */}
      <ol className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-0">
        {pipeline.map((step, index) => {
          const reached = status !== "cancelled" && index <= currentIndex;
          const isLast = index === pipeline.length - 1;
          return (
            <li key={step} className="flex items-center sm:flex-1">
              <button
                type="button"
                onClick={() => setStatus(step)}
                className={cn(
                  "flex h-11 w-full items-center gap-2 rounded-field px-3 text-sm font-medium transition-colors sm:w-auto",
                  reached
                    ? "text-brand-800"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                    reached
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-line-strong bg-surface text-ink-muted",
                  )}
                >
                  {reached ? <Check className="size-3.5" /> : index + 1}
                </span>
                {dict.status[step]}
              </button>
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-1 hidden h-px flex-1 sm:block",
                    status !== "cancelled" && index < currentIndex
                      ? "bg-brand-400"
                      : "bg-line-strong",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Cancel toggle */}
      <button
        type="button"
        onClick={() =>
          setStatus((prev) => (prev === "cancelled" ? "new" : "cancelled"))
        }
        className={cn(
          "self-start rounded-field px-3 py-2 text-sm font-medium transition-colors",
          status === "cancelled"
            ? "bg-danger-soft text-danger"
            : "text-ink-muted hover:bg-danger-soft hover:text-danger",
        )}
      >
        {dict.status.cancelled}
      </button>
    </div>
  );
}
