"use server";

/**
 * Product-showcase link Server Actions (M7H.3). Owner/admin issue a
 * view-only catalog link at `/[locale]/showcase/<token>` (raw token generated
 * here, returned once; only its SHA-256 hash is stored). No customer, no
 * ordering — a prospective buyer browses then requests a store account.
 */
import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  insertShowcaseLink,
  revokeShowcaseLink,
} from "@/lib/data/catalog-showcase";
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

function safeLocale(locale: unknown): string {
  return typeof locale === "string" && /^[a-z]{2}$/.test(locale) ? locale : "he";
}

export interface CreateShowcaseLinkResult {
  ok: boolean;
  /** Full showcase URL — shown/copied once, never retrievable again. */
  url?: string;
}

export async function createShowcaseLinkAction(input: {
  label?: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateShowcaseLinkResult> {
  try {
    const locale = safeLocale(input.locale);
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

    await insertShowcaseLink({ tokenHash, tokenPreview, label, expiresAt });
    revalidatePath(`/${locale}/admin/customers/signup`);
    return { ok: true, url: `/${locale}/showcase/${rawToken}` };
  } catch (error) {
    console.error("[madaf/actions] createShowcaseLinkAction failed:", error);
    return { ok: false };
  }
}

export async function revokeShowcaseLinkAction(input: {
  linkId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isPlausibleId(input.linkId)) return { ok: false };
    await revokeShowcaseLink(input.linkId);
    revalidatePath(`/${safeLocale(input.locale)}/admin/customers/signup`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] revokeShowcaseLinkAction failed:", error);
    return { ok: false };
  }
}
