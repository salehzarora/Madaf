"use server";

/**
 * sales_rep customer-assignment Server Actions (M4D) — owner/admin only.
 * The RPCs (assign/unassign) re-verify membership + role and that the target
 * is a sales_rep of the selected tenant and the customer belongs to it;
 * these actions never trust a client tenant_id.
 */
import { revalidatePath } from "next/cache";

import {
  assignCustomerToRep,
  unassignCustomerFromRep,
} from "@/lib/data/rep-assignments";

function safeLocale(value: unknown): string {
  return typeof value === "string" && /^[a-z]{2}$/.test(value) ? value : "he";
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

export async function assignCustomerAction(input: {
  userId: string;
  customerId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isId(input.userId) || !isId(input.customerId)) return { ok: false };
    await assignCustomerToRep({
      userId: input.userId,
      customerId: input.customerId,
    });
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] assignCustomerAction failed:", error);
    return { ok: false };
  }
}

export async function unassignCustomerAction(input: {
  userId: string;
  customerId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isId(input.userId) || !isId(input.customerId)) return { ok: false };
    await unassignCustomerFromRep({
      userId: input.userId,
      customerId: input.customerId,
    });
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] unassignCustomerAction failed:", error);
    return { ok: false };
  }
}
