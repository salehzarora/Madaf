"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDataMode } from "@/lib/data/mode";
import { basePrices, PricingError, resolvePriceBatches, type PriceResult, type PricingScope } from "@/lib/pricing";
import type { Product } from "@/lib/types";

/** Memory only. The generation is part of identity, including A→B→A. */
export function useEffectivePrices(products: Product[], scope: PricingScope, generation = 0) {
  const [refresh, setRefresh] = useState(0);
  const scopeKey = JSON.stringify(scope);
  const idsKey = JSON.stringify(products.map(p => p.id));
  const termsKey = JSON.stringify(products.map(p => [p.id, p.wholesalePrice, p.vatRate, p.packageType, p.unitsPerPackage, p.baseUnit, p.unitSize, p.isActive]));
  const key = `${scopeKey}:${generation}:${refresh}:${termsKey}`;
  const request = useRef(0);
  const [result, setResult] = useState<{ key: string; data: PriceResult | null; error?: "denied" | "unavailable" } | null>(null);
  const mock = getDataMode() === "mock";
  useEffect(() => {
    if (mock) return;
    const refreshCurrent = () => setRefresh(v => v + 1);
    window.addEventListener("focus", refreshCurrent);
    window.addEventListener("online", refreshCurrent);
    return () => {
      window.removeEventListener("focus", refreshCurrent);
      window.removeEventListener("online", refreshCurrent);
    };
  }, [mock]);
  useEffect(() => {
    if (mock) return;
    const epoch = ++request.current;
    let cancelled = false;
    resolvePriceBatches(JSON.parse(idsKey), async ids => {
      const { resolvePricesAction } = await import("@/lib/actions/pricing");
      const data = await resolvePricesAction(JSON.parse(scopeKey), ids);
      if (!data) throw new Error("pricing unavailable");
      if ("error" in data) throw new PricingError(data.error);
      return data;
    }).then(data => {
      if (!cancelled && request.current === epoch) setResult({ key, data });
    }, error => {
      if (!cancelled && request.current === epoch) setResult({ key, data: null, error: error instanceof PricingError ? error.reason : "unavailable" });
    });
    return () => { cancelled = true; };
  }, [idsKey, scopeKey, key, mock]);
  const data = useMemo(() => mock ? basePrices(products) : result?.key === key ? result.data : null, [mock, products, result, key]);
  const ready = data !== null;
  const prices = useMemo(() => new Map(data?.prices.map(p => [p.product_id, p]) ?? []), [data]);
  const priceOf = useCallback((id: string): number | null => {
    const p = prices.get(id);
    return p && (p.status === "base" || p.status === "customer_agreement") ? Number(p.price) : null;
  }, [prices]);
  const retry = useCallback(() => setRefresh(v => v + 1), []);
  return { ready, mode: data?.mode, prices, priceOf, retry, key,
    problem: result?.key === key && result.error ? result.error : data?.prices.some(p => p.status === "stale_package") ? "stale_package" as const
      : data?.prices.some(p => p.status === "unavailable") ? "unavailable" as const : undefined,
    unavailable: !mock && result?.key === key && result.data === null };
}
