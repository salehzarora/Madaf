"use server";

/**
 * Order write Server Actions (M3A).
 *
 * The only bridge between client components and the write side of the
 * data layer. Client components import THESE (Next compiles them to RPC
 * stubs); the server-only Supabase modules stay out of every client
 * bundle.
 *
 * Inputs are re-validated here — a Server Action is a public endpoint,
 * so nothing from the client is trusted: ids must look like ids,
 * quantities are bounded, and ALL pricing happens in the database from
 * live product data regardless of what the cart claims.
 *
 * Errors are logged server-side and returned as generic flags — the UI
 * shows a localized message from the dictionary.
 */
import { revalidatePath } from "next/cache";

import { createOrderRequest, updateOrderStatus } from "@/lib/data";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/types";

const MAX_LINES = 200;
const MAX_QUANTITY = 9999;
const MAX_NOTES_LENGTH = 2000;
const MAX_ID_LENGTH = 64;

function isPlausibleId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

export interface SubmitOrderResult {
  ok: boolean;
  orderNumber?: string;
}

export async function submitOrderAction(input: {
  customerId: string | null;
  items: { productId: string; quantity: number }[];
  notes?: string;
  locale: string;
}): Promise<SubmitOrderResult> {
  try {
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0 || items.length > MAX_LINES) return { ok: false };
    for (const item of items) {
      if (
        typeof item.productId !== "string" ||
        !isPlausibleId(item.productId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > MAX_QUANTITY
      ) {
        return { ok: false };
      }
    }
    const customerId =
      typeof input.customerId === "string" && isPlausibleId(input.customerId)
        ? input.customerId
        : null;
    const notes =
      typeof input.notes === "string"
        ? input.notes.slice(0, MAX_NOTES_LENGTH)
        : undefined;

    const result = await createOrderRequest({
      customerId,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      notes,
      // The M3A checkout is the sales/shop flow; remote_customer/admin
      // sources arrive with tokenized links and admin tooling (M4+).
      source: "sales_visit",
    });

    if (typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)) {
      revalidatePath(`/${input.locale}/admin/orders`);
      revalidatePath(`/${input.locale}/admin`);
    }
    return { ok: true, orderNumber: result.orderNumber };
  } catch (error) {
    console.error("[madaf/actions] submitOrderAction failed:", error);
    return { ok: false };
  }
}

export interface UpdateStatusResult {
  ok: boolean;
  status?: OrderStatus;
}

export async function updateOrderStatusAction(input: {
  orderId: string;
  nextStatus: OrderStatus;
  locale: string;
}): Promise<UpdateStatusResult> {
  try {
    if (
      typeof input.orderId !== "string" ||
      !isPlausibleId(input.orderId) ||
      !ORDER_STATUSES.includes(input.nextStatus)
    ) {
      return { ok: false };
    }

    const result = await updateOrderStatus(input.orderId, input.nextStatus);

    if (typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)) {
      revalidatePath(`/${input.locale}/admin/orders`);
      revalidatePath(`/${input.locale}/admin/orders/${input.orderId}`);
      revalidatePath(`/${input.locale}/admin`);
    }
    return { ok: true, status: result.newStatus };
  } catch (error) {
    console.error("[madaf/actions] updateOrderStatusAction failed:", error);
    return { ok: false };
  }
}
