"use server";
import { resolvePrices, quoteOrder, listAgreements, manageAgreement } from "@/lib/data/pricing";
import { PricingError, validAgreementPrice, type PricingScope, type PriceResult, type PricingFailure } from "@/lib/pricing";

// No request, token, quote, provider object or price is logged on failures.
export async function resolvePricesAction(scope: PricingScope, ids: string[]): Promise<PriceResult | PricingFailure> {
  try { return await resolvePrices(scope, ids); }
  catch (error) { return { error: error instanceof PricingError ? error.reason : "unavailable" }; }
}
export async function quoteOrderAction(scope: PricingScope, items: { productId: string; quantity: number }[]) {
  try { return await quoteOrder(scope, items); } catch { return null; }
}
export async function listAgreementsAction(customerId: string, search: string) {
  try { return await listAgreements(customerId, search); } catch { return null; }
}
export async function manageAgreementAction(input: { customerId: string; productId: string; action: "set" | "reconfirm" | "remove"; revision: number; packageRevision: number; price?: string }) {
  try {
    if (!["set","reconfirm","remove"].includes(input.action) || (input.action !== "remove" && !validAgreementPrice(input.price))) return false;
    await manageAgreement(input); return true;
  } catch { return false; }
}
