"use client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/format";

/** Narrow client leaf; the product detail and related tiles stay server components. */
export function EffectivePrice({ productId, locale, divisor = 1, quantity = 1 }: {
  productId: string; locale: Locale; divisor?: number; quantity?: number;
}) {
  const { priceOf } = useCart();
  const price = priceOf(productId);
  return <>{price === null ? "—" : formatCurrency(price * quantity / divisor, locale)}</>;
}
export function PricingStatus({ dict }: { dict: Dictionary }) {
  const { pricingMode, pricingProblem, refreshPrices } = useCart();
  // Pending prices remain fail-closed, but loading is not a pricing failure.
  if (pricingMode !== "paused" && !pricingProblem) return null;
  return <p role="status" className="my-2 text-sm text-ink-soft">
    {pricingMode === "paused" ? dict.pricing.paused : pricingProblem === "stale_package" ? dict.pricing.stale : pricingProblem === "denied" ? dict.pricing.denied : dict.pricing.unavailable}{" "}
    <button type="button" onClick={refreshPrices} className="underline">{dict.pricing.retry}</button>
  </p>;
}
