import type { LocalizedText, Product } from "@/lib/types";

export type PricingMode = "disabled" | "active" | "paused";
export type PriceStatus = "base" | "customer_agreement" | "stale_package" | "unavailable" | "paused";
export type QuoteEnvelope = { version: 1; digest: string };
export type QuoteInput = QuoteEnvelope | { mode: "replay_only" };
export type PricingScope = { customerId: string | null; orderId?: string } | { token: string; showcase: boolean };
export interface EffectivePrice { product_id: string; status: PriceStatus; price: string | null; vat: string | null }
export interface PriceResult { mode: PricingMode; prices: EffectivePrice[] }
export interface PricingFailure { error: "denied" | "unavailable" }
export interface OrderQuote {
  quote: QuoteEnvelope;
  mode: PricingMode;
  lines: { product_id: string; quantity: number; unit_price_snapshot: string; vat_rate_snapshot: string; line_subtotal: string; line_vat: string; line_total: string }[];
  headers: { subtotal: string; vat: string; total: string };
  unchangedItems: boolean;
}
export interface AgreementProduct {
  id: string; name: LocalizedText; packageUnit: string; packageQuantity: number;
  baseUnit: string; unitSize: string | null; basePrice: string; price: string | null;
  revision: number; packageRevision: number; status: "base" | "customer_agreement" | "stale_package" | "removed";
}
export interface AgreementList { mode: PricingMode; products: AgreementProduct[] }
export function validAgreementPrice(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)
    && value.length <= 16 && Number(value) >= 0.01 && Number(value) <= 9_999_999;
}
export function validQuote(value: unknown): value is QuoteInput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (Object.keys(v).length === 1 && v.mode === "replay_only") ||
    (Object.keys(v).length === 2 && v.version === 1 && typeof v.digest === "string" && /^[a-f0-9]{64}$/.test(v.digest));
}
export class PricingError extends Error {
  constructor(readonly reason: "denied" | "unavailable" = "unavailable") { super("pricing_requires_review"); this.name = "PricingError"; }
}
export function throwPricingError(error: { code?: string } | null): void {
  if (error?.code && /^MDF5[0-5]$/.test(error.code)) throw new PricingError();
}
export function basePrices(products: Product[]): PriceResult {
  return { mode: "disabled", prices: products.map(p => ({ product_id: p.id, status: "base", price: p.wholesalePrice.toFixed(2), vat: String(p.vatRate ?? 0.18) })) };
}
/** Resolve every candidate before price sorting; at most two bounded requests run at once. */
export async function resolvePriceBatches(ids: string[], load: (ids: string[]) => Promise<PriceResult>): Promise<PriceResult> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 200) batches.push(unique.slice(i, i + 200));
  if (!batches.length) batches.push([]); // Still validate the customer/state.
  const results: PriceResult[] = [];
  for (let i = 0; i < batches.length; i += 2) results.push(...await Promise.all(batches.slice(i, i + 2).map(load)));
  if (results.some(r => r.mode !== results[0].mode)) throw new PricingError();
  const prices = results.flatMap(r => r.prices);
  if (prices.length !== unique.length || new Set(prices.map(p => p.product_id)).size !== unique.length
    || prices.some(p => !unique.includes(p.product_id))) throw new PricingError();
  for (const price of prices) {
    if (price.status === "base" || price.status === "customer_agreement") {
      if (typeof price.price !== "string" || !/^\d+\.\d{2}$/.test(price.price) || Number(price.price) > 9_999_999
        || typeof price.vat !== "string" || !/^\d+(?:\.\d+)?$/.test(price.vat) || Number(price.vat) >= 1) throw new PricingError();
    } else if (!["stale_package", "unavailable", "paused"].includes(price.status) || price.price !== null || price.vat !== null) throw new PricingError();
  }
  return { mode: results[0].mode, prices };
}
