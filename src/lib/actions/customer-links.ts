"use server";

/**
 * Private shop-link Server Actions (M4A) — authenticated owner/admin.
 *
 * The raw token is generated HERE (32 secure random bytes, base64url) and
 * returned to the admin exactly once; only its SHA-256 hash is stored (via
 * the insert RPC). The shop URL is `/[locale]/shop/<rawToken>`.
 */
import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  insertCustomerLink,
  revokeCustomerLink,
} from "@/lib/data/customer-links";
import { hashToken } from "@/lib/data/token";

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
  /** The full shop URL — shown/copied once, never retrievable again. */
  url?: string;
}

export async function createCustomerLinkAction(input: {
  customerId: string;
  label?: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateLinkResult> {
  try {
    if (!isPlausibleId(input.customerId)) return { ok: false };
    const locale =
      typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)
        ? input.locale
        : "he";

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const tokenPreview = rawToken.slice(-6);

    const label =
      typeof input.label === "string" && input.label.trim()
        ? input.label.trim().slice(0, MAX_LABEL)
        : undefined;

    let expiresAt: string | undefined;
    const days = input.expiresInDays;
    if (typeof days === "number" && days > 0 && days <= MAX_EXPIRY_DAYS) {
      expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
    }

    await insertCustomerLink({
      customerId: input.customerId,
      tokenHash,
      tokenPreview,
      label,
      expiresAt,
    });

    revalidatePath(`/${locale}/admin/customers/${input.customerId}`);
    return { ok: true, url: `/${locale}/shop/${rawToken}` };
  } catch (error) {
    console.error("[madaf/actions] createCustomerLinkAction failed:", error);
    return { ok: false };
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
