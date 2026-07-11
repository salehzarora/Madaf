"use server";

/**
 * New-store signup Server Actions (M7G).
 *
 * Owner/admin issue a tenant-scoped signup link (raw token generated HERE,
 * returned once; only its SHA-256 hash is stored) at `/[locale]/join/<token>`.
 * A prospective store submits its details through the anon submit action; the
 * request lands PENDING for owner/admin review. Approve/reject go through the
 * SECURITY DEFINER RPCs (tenant re-derived server-side; never trusted).
 */
import { revalidatePath } from "next/cache";

import {
  approveSignupRequest,
  insertSignupLink,
  listSignupRequests,
  rejectSignupRequest,
  revokeSignupLink,
  submitSignupRequest,
} from "@/lib/data/customer-signup";
import {
  findCustomerDuplicates,
  type CustomerDuplicate,
} from "@/lib/data/customers";
import { hashToken } from "@/lib/data/token";
import { createCanonicalLink } from "@/lib/public-link";
import { resolveServerCanonicalOrigin } from "@/lib/public-url-server";

const MAX_LABEL = 80;
const MAX_EXPIRY_DAYS = 365;
const MAX_NAME = 200;
const MAX_PHONE = 40;
const MAX_EMAIL = 254;
const MAX_CITY = 120;
const MAX_ADDRESS = 300;
const MAX_NOTES = 2000;

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function safeLocale(locale: unknown): string {
  return typeof locale === "string" && /^[a-z]{2}$/.test(locale) ? locale : "he";
}

export interface CreateSignupLinkResult {
  ok: boolean;
  /** Full join URL — shown/copied once, never retrievable again. */
  url?: string;
  /** M8E.2 — canonical public app URL missing/invalid; no link created. */
  reason?: "config";
}

export async function createSignupLinkAction(input: {
  label?: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateSignupLinkResult> {
  try {
    const locale = safeLocale(input.locale);
    const label = str(input.label, MAX_LABEL);

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
      routeType: "join",
      resolveOrigin: resolveServerCanonicalOrigin,
      persist: async ({ rawToken }) => {
        await insertSignupLink({
          tokenHash: hashToken(rawToken),
          tokenPreview: rawToken.slice(-6),
          label,
          expiresAt,
        });
      },
    });
    if (!created.ok) return { ok: false, reason: "config" };
    revalidatePath(`/${locale}/admin/customers/signup`);
    return { ok: true, url: created.url };
  } catch (error) {
    console.error("[madaf/actions] createSignupLinkAction failed:", error);
    return { ok: false };
  }
}

export async function revokeSignupLinkAction(input: {
  linkId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isPlausibleId(input.linkId)) return { ok: false };
    await revokeSignupLink(input.linkId);
    revalidatePath(`/${safeLocale(input.locale)}/admin/customers/signup`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] revokeSignupLinkAction failed:", error);
    return { ok: false };
  }
}

export async function submitSignupRequestAction(input: {
  token: string;
  store: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  try {
    if (typeof input.token !== "string" || input.token.length < 16) {
      return { ok: false };
    }
    const raw = input.store ?? {};
    const name = str(raw.name, MAX_NAME);
    if (!name) return { ok: false };
    const ok = await submitSignupRequest(input.token, {
      name,
      contactName: str(raw.contactName, MAX_NAME),
      phone: str(raw.phone, MAX_PHONE),
      email: str(raw.email, MAX_EMAIL),
      cityAr: str(raw.cityAr, MAX_CITY),
      cityHe: str(raw.cityHe, MAX_CITY),
      cityEn: str(raw.cityEn, MAX_CITY),
      address: str(raw.address, MAX_ADDRESS),
      notes: str(raw.notes, MAX_NOTES),
    });
    return { ok };
  } catch (error) {
    console.error("[madaf/actions] submitSignupRequestAction failed:", error);
    return { ok: false };
  }
}

function revalidateRequests(locale: string): void {
  revalidatePath(`/${locale}/admin/customers/signup`);
  revalidatePath(`/${locale}/admin/customers`);
  revalidatePath(`/${locale}`, "layout"); // ShopDataProvider (new customer)
}

export interface ApproveSignupResult {
  ok: boolean;
  customerId?: string;
  /** Existing same-phone/name customers (M8B.3) — the admin must confirm
   * (confirmDuplicate: true) to approve into a look-alike store anyway. */
  duplicates?: CustomerDuplicate[];
}

export async function approveSignupRequestAction(input: {
  requestId: string;
  locale: string;
  confirmDuplicate?: boolean;
}): Promise<ApproveSignupResult> {
  try {
    if (!isPlausibleId(input.requestId)) return { ok: false };

    // M8B.3 duplicate guard: approval CREATES a customer, so check the
    // pending request's name/phone against existing stores first.
    if (input.confirmDuplicate !== true) {
      const request = (await listSignupRequests()).find(
        (r) => r.id === input.requestId,
      );
      if (request) {
        const duplicates = await findCustomerDuplicates({
          name: request.name,
          phone: request.phone ?? undefined,
        });
        if (duplicates.length > 0) {
          return { ok: false, duplicates: duplicates.slice(0, 5) };
        }
      }
    }

    const result = await approveSignupRequest(input.requestId);
    revalidateRequests(safeLocale(input.locale));
    return { ok: true, customerId: result.customerId };
  } catch (error) {
    console.error("[madaf/actions] approveSignupRequestAction failed:", error);
    return { ok: false };
  }
}

export async function rejectSignupRequestAction(input: {
  requestId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isPlausibleId(input.requestId)) return { ok: false };
    await rejectSignupRequest(input.requestId);
    revalidateRequests(safeLocale(input.locale));
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] rejectSignupRequestAction failed:", error);
    return { ok: false };
  }
}
