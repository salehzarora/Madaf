"use server";

/**
 * Tokenized shop-order Server Action (M4A). A shop (no login) submits an
 * order through its private link. The token — not the customer/tenant —
 * is the credential; the DB derives tenant+customer from the token and
 * computes all money server-side (source = remote_customer).
 */
import {
  isSubmissionConflict,
  isSubmissionKey,
} from "@/lib/actions/order-submission";
import { submitTokenOrder } from "@/lib/data/token";

const MAX_LINES = 200;
const MAX_QUANTITY = 9999;
const MAX_NOTES = 2000;

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

export interface ShopOrderResult {
  ok: boolean;
  /** Customer-facing public order ref (MDF-XXXXXXXX) — never the internal
   * sequential number (the token RPC returns public_ref). */
  publicRef?: string;
  /** "conflict" when the submission key was reused with a changed cart (MDF40). */
  reason?: "conflict";
}

export async function submitShopOrderAction(input: {
  token: string;
  items: { productId: string; quantity: number }[];
  notes?: string;
  /** DB-backed idempotency key (FIX1) — reused across retries of one submission. */
  submissionKey: string;
}): Promise<ShopOrderResult> {
  try {
    if (typeof input.token !== "string" || input.token.length < 16) {
      return { ok: false };
    }
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
    if (!isSubmissionKey(input.submissionKey)) return { ok: false };
    const notes =
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.slice(0, MAX_NOTES)
        : undefined;

    const publicRef = await submitTokenOrder(
      input.token,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      input.submissionKey,
      notes,
    );
    if (!publicRef) return { ok: false };
    return { ok: true, publicRef };
  } catch (error) {
    if (isSubmissionConflict(error)) return { ok: false, reason: "conflict" };
    console.error("[madaf/actions] submitShopOrderAction failed:", error);
    return { ok: false };
  }
}
