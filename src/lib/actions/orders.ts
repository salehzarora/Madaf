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

import {
  createCustomerFromOrder,
  createOrderRequest,
  updateOrderItems,
  updateOrderStatus,
} from "@/lib/data";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/types";

/** Maps the DB insufficient-stock error (MDF30) to a UI reason. */
function isInsufficientStock(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("insufficient stock")
  );
}

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
  /** Customer-facing public ref (MDF-XXXXXXXX) — shown on the success page. */
  publicRef?: string;
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
    // Customer-facing success page shows the public ref, never the internal
    // sequential number (M7G).
    return { ok: true, publicRef: result.publicRef };
  } catch (error) {
    console.error("[madaf/actions] submitOrderAction failed:", error);
    return { ok: false };
  }
}

export interface UpdateStatusResult {
  ok: boolean;
  status?: OrderStatus;
  /** "insufficient_stock" when reserving on confirm/preparing was blocked. */
  reason?: "insufficient_stock";
}

function revalidateOrder(locale: string, orderId: string): void {
  if (typeof locale !== "string" || !/^[a-z]{2}$/.test(locale)) return;
  revalidatePath(`/${locale}/admin/orders`);
  revalidatePath(`/${locale}/admin/orders/${orderId}`);
  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/admin/inventory`);
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
    revalidateOrder(input.locale, input.orderId);
    return { ok: true, status: result.newStatus };
  } catch (error) {
    if (isInsufficientStock(error)) {
      return { ok: false, reason: "insufficient_stock" };
    }
    console.error("[madaf/actions] updateOrderStatusAction failed:", error);
    return { ok: false };
  }
}

export interface EditOrderResult {
  ok: boolean;
  reason?: "insufficient_stock" | "locked";
}

/** M7I.3 — owner/admin edit an order's lines (+ notes). */
export async function updateOrderItemsAction(input: {
  orderId: string;
  items: { productId: string; quantity: number }[];
  notes?: string;
  locale: string;
}): Promise<EditOrderResult> {
  try {
    if (!isPlausibleId(input.orderId)) return { ok: false };
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0 || items.length > MAX_LINES) return { ok: false };
    for (const item of items) {
      if (
        !isPlausibleId(item.productId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > MAX_QUANTITY
      ) {
        return { ok: false };
      }
    }
    const notes =
      typeof input.notes === "string"
        ? input.notes.slice(0, MAX_NOTES_LENGTH)
        : undefined;
    await updateOrderItems(
      input.orderId,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      notes,
    );
    revalidateOrder(input.locale, input.orderId);
    return { ok: true };
  } catch (error) {
    if (isInsufficientStock(error)) return { ok: false, reason: "insufficient_stock" };
    if (error instanceof Error && error.message.includes("cannot be edited")) {
      return { ok: false, reason: "locked" };
    }
    console.error("[madaf/actions] updateOrderItemsAction failed:", error);
    return { ok: false };
  }
}

/** M7I.1 — owner/admin create a permanent customer from a guest order. */
export async function createCustomerFromOrderAction(input: {
  orderId: string;
  locale: string;
}): Promise<{ ok: boolean; customerId?: string }> {
  try {
    if (!isPlausibleId(input.orderId)) return { ok: false };
    const result = await createCustomerFromOrder(input.orderId);
    revalidateOrder(input.locale, input.orderId);
    if (typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)) {
      revalidatePath(`/${input.locale}`, "layout");
      revalidatePath(`/${input.locale}/admin/customers`);
    }
    return { ok: true, customerId: result.customerId };
  } catch (error) {
    console.error("[madaf/actions] createCustomerFromOrderAction failed:", error);
    return { ok: false };
  }
}
