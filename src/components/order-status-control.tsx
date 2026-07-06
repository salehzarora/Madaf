"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { OrderStatusBadge } from "@/components/order-status-badge";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { updateOrderStatusAction } from "@/lib/actions/orders";
import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Visual order-status pipeline for the admin order detail.
 *
 * - Mock mode (live=false): state is local only and resets on reload —
 *   the original M0 demo behavior, any step clickable.
 * - Supabase mode (live=true): clicks call the order Server Action; the
 *   database validates the transition (new → confirmed → preparing →
 *   delivered, cancel from any active state) and the trigger writes the
 *   status history. Impossible transitions are disabled.
 */
export function OrderStatusControl({
  orderId,
  initialStatus,
  locale,
  live,
  dict,
}: {
  orderId: string;
  initialStatus: OrderStatus;
  locale: Locale;
  live: boolean;
  dict: Dictionary;
}) {
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const pipeline: OrderStatus[] = ["new", "confirmed", "preparing", "delivered"];
  const currentIndex = pipeline.indexOf(status);
  const allowed = ORDER_STATUS_TRANSITIONS[status];

  function select(next: OrderStatus) {
    if (next === status) return;
    if (!live) {
      setStatus(next);
      return;
    }
    if (!allowed.includes(next)) return;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await updateOrderStatusAction({
          orderId,
          nextStatus: next,
          locale,
        });
        if (result.ok && result.status) {
          setStatus(result.status);
          return;
        }
      } catch {
        // Transport-level failure — fall through to the error message.
      }
      setFailed(true);
    });
  }

  return (
    <div className={cn("flex flex-col gap-4", pending && "opacity-70")}>
      <div className="flex items-center gap-2">
        <OrderStatusBadge status={status} dict={dict.status} />
        <p className="text-xs text-ink-muted">
          {live
            ? dict.admin.orders.detail.statusHintLive
            : dict.admin.orders.detail.statusHint}
        </p>
      </div>

      {/* Pipeline steps */}
      <ol className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-0">
        {pipeline.map((step, index) => {
          const reached = status !== "cancelled" && index <= currentIndex;
          const isLast = index === pipeline.length - 1;
          const clickable =
            !pending && (!live || step === status || allowed.includes(step));
          return (
            <li key={step} className="flex items-center sm:flex-1">
              <button
                type="button"
                onClick={() => select(step)}
                disabled={!clickable}
                className={cn(
                  "flex h-11 w-full items-center gap-2 rounded-field px-3 text-sm font-medium transition-colors sm:w-auto",
                  reached
                    ? "text-brand-800"
                    : "text-ink-muted hover:text-ink",
                  live && !clickable && "cursor-not-allowed hover:text-ink-muted",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-badge border text-xs font-bold tabular-nums transition-colors",
                    reached
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-line-strong bg-surface text-ink-muted",
                  )}
                >
                  {reached ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                {dict.status[step]}
              </button>
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-1 hidden h-0.5 flex-1 sm:block",
                    status !== "cancelled" && index < currentIndex
                      ? "bg-brand-600"
                      : "bg-line-strong",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Cancel toggle (mock) / cancel action (live — terminal, no undo) */}
      <button
        type="button"
        onClick={() =>
          live
            ? select("cancelled")
            : setStatus((prev) => (prev === "cancelled" ? "new" : "cancelled"))
        }
        disabled={pending || (live && !allowed.includes("cancelled"))}
        className={cn(
          "self-start rounded-field px-3 py-2 text-sm font-medium transition-colors",
          status === "cancelled"
            ? "bg-danger-soft text-danger"
            : "text-ink-muted hover:bg-danger-soft hover:text-danger",
          live &&
            !allowed.includes("cancelled") &&
            status !== "cancelled" &&
            "cursor-not-allowed hover:bg-transparent hover:text-ink-muted",
        )}
      >
        {dict.status.cancelled}
      </button>

      {failed ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {dict.admin.orders.detail.statusUpdateError}
        </p>
      ) : null}
    </div>
  );
}
