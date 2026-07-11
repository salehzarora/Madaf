"use server";

/**
 * Private shop-link Server Actions (M4A) — authenticated owner/admin.
 *
 * The raw token is generated HERE (32 secure random bytes, base64url) and
 * returned to the admin exactly once; only its SHA-256 hash is stored (via
 * the insert RPC). The shop URL is `/[locale]/shop/<rawToken>`.
 */
import { revalidatePath } from "next/cache";

import {
  replaceCustomerLink,
  revokeCustomerLink,
} from "@/lib/data/customer-links";
import { getCustomer } from "@/lib/data";
import { hashToken } from "@/lib/data/token";
import { createCanonicalLink } from "@/lib/public-link";
import { resolveServerCanonicalOrigin } from "@/lib/public-url-server";
import { isInactiveStoreError } from "@/lib/actions/link-errors";

const MAX_LABEL = 80;
const MAX_EXPIRY_DAYS = 365;

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

export interface CreateLinkResult {
  ok: boolean;
  /** The full ABSOLUTE canonical shop URL — shown/copied once, never
   * retrievable again. Built + validated server-side before any mutation. */
  url?: string;
  /**
   * Failure category (M8E.2 review #7 — never mislabel one as another):
   *  - "inactive"    — the store is deactivated (MDF33); no link created/revoked.
   *  - "config"      — the canonical public app URL is missing/invalid/conflict;
   *                    nothing revoked or persisted.
   *  - "validation"  — an input/part was invalid when building the URL.
   *  - "persistence" — the atomic DB replacement (or transport) failed; the
   *                    transaction rolled back, so the previous link survives.
   */
  reason?: "inactive" | "config" | "validation" | "persistence";
}

export async function createCustomerLinkAction(input: {
  customerId: string;
  label?: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateLinkResult> {
  try {
    if (!isPlausibleId(input.customerId)) {
      return { ok: false, reason: "validation" };
    }
    const locale =
      typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)
        ? input.locale
        : "he";

    const label =
      typeof input.label === "string" && input.label.trim()
        ? input.label.trim().slice(0, MAX_LABEL)
        : undefined;

    let expiresAt: string | undefined;
    const days = input.expiresInDays;
    if (typeof days === "number" && days > 0 && days <= MAX_EXPIRY_DAYS) {
      expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
    }

    // M8C: refuse BEFORE any mutation — an inactive store gets no new link
    // (the atomic RPC also blocks with MDF33 as the real gate). Read only.
    const customer = await getCustomer(input.customerId);
    if (customer && customer.isActive === false) {
      return { ok: false, reason: "inactive" };
    }

    // M8E.2: generate + validate the ABSOLUTE canonical link, and ONLY on
    // success run the ATOMIC replace (revoke ALL active links + insert the
    // fresh one in ONE transaction — a store keeps exactly ONE live link, and a
    // failed insert rolls back the revoke). If the canonical URL can't be
    // produced, NOTHING is revoked or persisted.
    const created = await createCanonicalLink({
      locale,
      routeType: "shop",
      resolveOrigin: resolveServerCanonicalOrigin,
      persist: async ({ rawToken }) => {
        await replaceCustomerLink({
          customerId: input.customerId,
          tokenHash: hashToken(rawToken),
          tokenPreview: rawToken.slice(-6),
          label,
          expiresAt,
        });
      },
    });
    if (!created.ok) return { ok: false, reason: created.reason };

    revalidatePath(`/${locale}/admin/customers/${input.customerId}`);
    return { ok: true, url: created.url };
  } catch (error) {
    // A deactivated store racing the pre-check surfaces as MDF33 from the RPC —
    // the transaction rolled back, so the previous link survives.
    if (isInactiveStoreError(error)) {
      return { ok: false, reason: "inactive" };
    }
    console.error("[madaf/actions] createCustomerLinkAction failed:", error);
    return { ok: false, reason: "persistence" };
  }
}

/**
 * Regenerate a store's private link (M7F.2, hardened M7H.1). Delegates to
 * createCustomerLinkAction, which now revokes ALL of the customer's active
 * links before issuing the fresh one — so EVERY old URL (not just the clicked
 * row) stops working. Only token_hash is stored; the raw token is shown once.
 */
export async function regenerateCustomerLinkAction(input: {
  linkId: string;
  customerId: string;
  label?: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateLinkResult> {
  try {
    if (!isPlausibleId(input.linkId) || !isPlausibleId(input.customerId)) {
      return { ok: false, reason: "validation" };
    }
    return await createCustomerLinkAction({
      customerId: input.customerId,
      label: input.label,
      expiresInDays: input.expiresInDays,
      locale: input.locale,
    });
  } catch (error) {
    console.error("[madaf/actions] regenerateCustomerLinkAction failed:", error);
    return { ok: false, reason: "persistence" };
  }
}

export async function revokeCustomerLinkAction(input: {
  linkId: string;
  customerId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isPlausibleId(input.linkId)) return { ok: false };
    await revokeCustomerLink(input.linkId);
    const locale =
      typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)
        ? input.locale
        : "he";
    if (isPlausibleId(input.customerId)) {
      revalidatePath(`/${locale}/admin/customers/${input.customerId}`);
    }
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] revokeCustomerLinkAction failed:", error);
    return { ok: false };
  }
}
