import "server-only";

/**
 * Supabase write implementations (M3A) — SERVER ONLY, orders only.
 *
 * Both writes are thin wrappers around service-role-only database RPCs
 * (supabase/migrations/20260705130000_order_write_rpcs.sql) that do the
 * real work atomically:
 *   - create_order_request: validates tenant/customer/products, computes
 *     ALL money server-side from live product data (client prices are
 *     never trusted), draws the order number via next_order_number(),
 *     inserts order + snapshotted lines in one transaction.
 *   - update_order_status: validated pipeline transition; the DB trigger
 *     writes order_status_history.
 *
 * Reached only through the data layer via dynamic import — never from
 * client code (see supabase-context.ts for the M3A access model).
 * No documents/invoice drafts are created here (M5).
 */
import { getServiceContext } from "./supabase-context";
import type { OrderSource } from "./orders";
import type { OrderStatus } from "@/lib/types";

function fail(what: string, message: string): never {
  throw new Error(`[madaf/data] supabase write failed (${what}): ${message}`);
}

export async function sbCreateOrderRequest(input: {
  customerId: string | null;
  items: { productId: string; quantity: number }[];
  notes?: string;
  source: OrderSource;
}): Promise<{ orderId: string; orderNumber: string }> {
  const { client, tenantId } = getServiceContext();
  const { data, error } = await client
    .rpc("create_order_request", {
      p_tenant_id: tenantId,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      ...(input.customerId ? { p_customer_id: input.customerId } : {}),
      ...(input.notes ? { p_notes: input.notes } : {}),
      p_source: input.source,
    })
    .single();
  if (error) fail("createOrderRequest", error.message);
  return { orderId: data.order_id, orderNumber: data.order_number };
}

export async function sbUpdateOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
): Promise<{ orderId: string; oldStatus: OrderStatus; newStatus: OrderStatus }> {
  const { client, tenantId } = getServiceContext();
  const { data, error } = await client
    .rpc("update_order_status", {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_new_status: nextStatus,
    })
    .single();
  if (error) fail("updateOrderStatus", error.message);
  return {
    orderId: data.order_id,
    oldStatus: data.old_status,
    newStatus: data.new_status,
  };
}
