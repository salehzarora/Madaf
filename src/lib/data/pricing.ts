import "server-only";
import { getDataContext, getSessionContext } from "@/lib/auth/session";
import { createServerAuthClient } from "@/lib/supabase/server-auth";
import { getDataMode } from "./mode";
import { listProducts } from "./products";
import { basePrices, PricingError, type PricingScope, type PriceResult, type OrderQuote, type AgreementList } from "@/lib/pricing";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** In-memory provider identity only, never an authorization value or persisted. */
export async function storefrontPricingIdentity(): Promise<string> {
  if (getDataMode() === "mock") return "mock";
  const { userId, membership } = await getSessionContext();
  return `${userId ?? "anonymous"}:${membership?.tenantId ?? "none"}:${membership?.role ?? "none"}`;
}
function checkScope(scope: PricingScope) {
  if (!scope || typeof scope !== "object") throw new PricingError();
  if ("token" in scope) {
    if (typeof scope.token !== "string" || scope.token.length < 16 || scope.token.length > 512 || typeof scope.showcase !== "boolean") throw new PricingError();
  } else if ((scope.customerId !== null && (typeof scope.customerId !== "string" || !uuid.test(scope.customerId)))
    || (scope.orderId !== undefined && !uuid.test(scope.orderId))) throw new PricingError();
}
export async function resolvePrices(scope: PricingScope, ids: string[]): Promise<PriceResult> {
  if (!Array.isArray(ids) || ids.length > 200) throw new PricingError();
  if (getDataMode() === "mock") return basePrices((await listProducts()).filter(p => ids.includes(p.id)));
  checkScope(scope);
  if (ids.some(id => typeof id !== "string" || !uuid.test(id))) throw new PricingError();
  let result;
  if ("token" in scope) {
    const client = await createServerAuthClient();
    result = await client.rpc("resolve_token_prices", { p_token: scope.token, p_product_ids: ids, p_showcase: scope.showcase });
  } else {
    const { client, tenantId } = await getDataContext();
    result = await client.rpc("resolve_customer_prices", { p_tenant_id: tenantId, p_customer_id: scope.customerId!, p_product_ids: ids });
  }
  if (result.error || !result.data) throw new PricingError(result.error?.code === "42501" || (!result.error && !result.data) ? "denied" : "unavailable");
  const data = result.data as unknown as PriceResult;
  if (!["disabled","active","paused"].includes(data.mode) || !Array.isArray(data.prices)) throw new PricingError();
  // Only the effective bounded DTO crosses the Server Action boundary.
  return { mode: data.mode, prices: data.prices.map(p => ({ product_id: p.product_id, status: p.status,
    price: p.status === "base" || p.status === "customer_agreement" ? p.price : null,
    vat: p.status === "base" || p.status === "customer_agreement" ? p.vat : null })) };
}
export async function quoteOrder(scope: PricingScope, items: { productId: string; quantity: number }[]): Promise<OrderQuote> {
  checkScope(scope);
  if (!Array.isArray(items) || items.length < 1 || items.length > 200 || items.some(i => !uuid.test(i.productId) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 9999)) throw new PricingError();
  const lines = items.map(i => ({ product_id: i.productId, quantity: i.quantity }));
  let result;
  if ("token" in scope) {
    const client = await createServerAuthClient();
    result = await client.rpc("quote_token_order", { p_token: scope.token, p_items: lines, p_showcase: scope.showcase });
  } else {
    const { client, tenantId } = await getDataContext();
    result = await client.rpc("quote_customer_order", { p_tenant_id: tenantId, p_items: lines, p_customer_id: scope.customerId!, ...(scope.orderId ? { p_order_id: scope.orderId } : {}) });
  }
  if (result.error || !result.data) throw new PricingError();
  const data = result.data as unknown as OrderQuote;
  return { quote: data.quote, mode: data.mode, headers: data.headers, unchangedItems: data.unchangedItems,
    lines: data.lines.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price_snapshot: i.unit_price_snapshot, vat_rate_snapshot: i.vat_rate_snapshot, line_subtotal: i.line_subtotal, line_vat: i.line_vat, line_total: i.line_total })) };
}
export async function listAgreements(customerId: string, search: string): Promise<AgreementList> {
  if (getDataMode() !== "supabase" || !uuid.test(customerId) || typeof search !== "string" || search.length > 100) throw new PricingError();
  const { client, tenantId } = await getDataContext();
  const { data, error } = await client.rpc("list_customer_product_prices", { p_tenant_id: tenantId, p_customer_id: customerId, p_search: search });
  if (error || !data) throw new PricingError();
  return data as unknown as AgreementList;
}
export async function manageAgreement(input: { customerId: string; productId: string; action: "set" | "reconfirm" | "remove"; revision: number; packageRevision: number; price?: string }): Promise<void> {
  if (getDataMode() !== "supabase" || !uuid.test(input.customerId) || !uuid.test(input.productId) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new PricingError();
  const { client, tenantId } = await getDataContext();
  const { error } = await client.rpc("manage_customer_product_price", { p_tenant_id: tenantId, p_customer_id: input.customerId,
    p_product_id: input.productId, p_action: input.action, p_expected_revision: input.revision, p_package_revision: input.packageRevision, ...(input.price !== undefined ? { p_price: input.price } : {}) });
  if (error) throw new PricingError();
}
