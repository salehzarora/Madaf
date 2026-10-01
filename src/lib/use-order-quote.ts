"use client";
import { useEffect, useState, useCallback } from "react";
import { getDataMode } from "@/lib/data/mode";
import type { OrderQuote, PricingScope } from "@/lib/pricing";

/** Fetch for review only. A response never triggers an order submission. */
export function useOrderQuote(scope: PricingScope, items: { productId: string; quantity: number }[], contextKey = "", enabled = true) {
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify(scope), itemsKey = JSON.stringify(items);
  const key = `${scopeKey}:${itemsKey}:${contextKey}:${revision}`;
  const [state, setState] = useState<{ key: string; quote: OrderQuote | null } | null>(null);
  useEffect(() => {
    if (!enabled || getDataMode() === "mock" || itemsKey === "[]") return;
    let cancelled = false;
    import("@/lib/actions/pricing").then(({ quoteOrderAction }) => quoteOrderAction(JSON.parse(scopeKey), JSON.parse(itemsKey))).then(quote => {
      if (!cancelled) setState({ key, quote });
    }, () => { if (!cancelled) setState({ key, quote: null }); });
    return () => { cancelled = true; };
  }, [key, scopeKey, itemsKey, enabled]);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  return { quote: enabled && state?.key === key ? state.quote : null, refresh,
    failed: enabled && state?.key === key && state.quote === null };
}
