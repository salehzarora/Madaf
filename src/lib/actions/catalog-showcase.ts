"use server";

/**
 * Product-showcase link Server Actions (M7H.3). Owner/admin issue a
 * view-only catalog link at `/[locale]/showcase/<token>` (raw token generated
 * here, returned once; only its SHA-256 hash is stored). No customer, no
 * ordering — a prospective buyer browses then requests a store account.
 */
import { revalidatePath } from "next/cache";

import {
  insertShowcaseLink,
  revokeShowcaseLink,
  submitShowcaseGuestOrder,
} from "@/lib/data/catalog-showcase";
import { hashToken } from "@/lib/data/token";
import { createCanonicalLink } from "@/lib/public-link";
import { resolveServerCanonicalOrigin } from "@/lib/public-url-server";

const MAX_LINES = 200;
const MAX_QUANTITY = 9999;
const MAX_NAME = 200;
const MAX_PHONE = 40;
const MAX_EMAIL = 254;
const MAX_CITY = 120;
const MAX_ADDRESS = 300;
const MAX_NOTES = 2000;

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

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
  /** Failure category (M8E.2 review #7): "config" — canonical public app URL
   * missing/invalid/conflict; "validation" — a part was invalid; "persistence"
   * — the DB/transport insert failed (nothing partially created). */
  reason?: "config" | "validation" | "persistence";
}

export async function createShowcaseLinkAction(input: {
  label?: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateShowcaseLinkResult> {
  try {
    const locale = safeLocale(input.locale);
    const label =
      typeof input.label === "string" && input.label.trim()
        ? input.label.trim().slice(0, MAX_LABEL)
        : undefined;

    let expiresAt: string | undefined;
    const days = input.expiresInDays;
    if (typeof days === "number" && days > 0 && days <= MAX_EXPIRY_DAYS) {
      expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
    }

    // M8E.2: generate + validate the ABSOLUTE canonical link, then (only on
    // success) persist the token hash — nothing is stored if the canonical URL
    // can't be produced.
    const created = await createCanonicalLink({
      locale,
      routeType: "showcase",
      resolveOrigin: resolveServerCanonicalOrigin,
      persist: async ({ rawToken }) => {
        await insertShowcaseLink({
          tokenHash: hashToken(rawToken),
          tokenPreview: rawToken.slice(-6),
          label,
          expiresAt,
        });
      },
    });
    if (!created.ok) return { ok: false, reason: created.reason };
    revalidatePath(`/${locale}/admin/customers/signup`);
    return { ok: true, url: created.url };
  } catch (error) {
    console.error("[madaf/actions] createShowcaseLinkAction failed:", error);
    return { ok: false, reason: "persistence" };
  }
}

export interface GuestOrderResult {
  ok: boolean;
  /** Customer-facing public ref (MDF-XXXXXXXX). */
  publicRef?: string;
}

/** Anon guest order from a showcase link (M7I.1). Tenant + store snapshot are
 * handled server-side; the visitor sees only the public ref. */
export async function submitShowcaseOrderAction(input: {
  token: string;
  items: { productId: string; quantity: number }[];
  store: Record<string, unknown>;
  notes?: string;
}): Promise<GuestOrderResult> {
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
    const raw = input.store ?? {};
    const name = str(raw.name, MAX_NAME);
    if (!name) return { ok: false };
    const publicRef = await submitShowcaseGuestOrder(
      input.token,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      {
        name,
        contactName: str(raw.contactName, MAX_NAME),
        phone: str(raw.phone, MAX_PHONE),
        email: str(raw.email, MAX_EMAIL),
        cityAr: str(raw.cityAr, MAX_CITY),
        cityHe: str(raw.cityHe, MAX_CITY),
        cityEn: str(raw.cityEn, MAX_CITY),
        address: str(raw.address, MAX_ADDRESS),
      },
      str(input.notes, MAX_NOTES),
    );
    if (!publicRef) return { ok: false };
    return { ok: true, publicRef };
  } catch (error) {
    console.error("[madaf/actions] submitShowcaseOrderAction failed:", error);
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
