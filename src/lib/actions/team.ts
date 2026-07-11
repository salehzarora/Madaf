"use server";

/**
 * Tenant team Server Actions (M4B).
 *
 * Membership/invite mutations are enforced entirely by the SECURITY DEFINER
 * RPCs (owner/admin gates, valid roles, no self-promotion, last-owner
 * protection, email-verified acceptance); these actions are thin adapters
 * that never trust a client tenant_id or role beyond what the DB re-checks.
 * The raw invite token is generated HERE (32 secure random bytes,
 * base64url), returned once, and only its SHA-256 hash is stored.
 */
import { revalidatePath } from "next/cache";

import {
  acceptInvite,
  demoteOwner,
  insertTenantInvite,
  promoteOwner,
  removeMember,
  revokeTenantInvite,
  updateMemberRole,
} from "@/lib/data/team";
import { hashToken } from "@/lib/data/token";
import { createCanonicalLink } from "@/lib/public-link";
import { resolveServerCanonicalOrigin } from "@/lib/public-url-server";

const MAX_EXPIRY_DAYS = 90;
type InviteRole = "admin" | "sales_rep";

function safeLocale(value: unknown): string {
  return typeof value === "string" && /^[a-z]{2}$/.test(value) ? value : "he";
}

function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  );
}

function isInviteRole(value: unknown): value is InviteRole {
  return value === "admin" || value === "sales_rep";
}

function isUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

export interface CreateInviteResult {
  ok: boolean;
  /** The full invite URL — shown/copied once, never retrievable again. */
  url?: string;
  /** M8E.2 — canonical public app URL missing/invalid; no link created. */
  reason?: "config";
}

export async function createInviteAction(input: {
  email: string;
  role: string;
  expiresInDays?: number;
  locale: string;
}): Promise<CreateInviteResult> {
  try {
    const locale = safeLocale(input.locale);
    const email = input.email;
    const role = input.role;
    // Narrow with type guards on `const`s so the values stay narrowed inside
    // the persist closure below.
    if (!isEmail(email) || !isInviteRole(role)) {
      return { ok: false };
    }

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
      routeType: "invite",
      resolveOrigin: resolveServerCanonicalOrigin,
      persist: async ({ rawToken }) => {
        await insertTenantInvite({
          email: email.trim().toLowerCase(),
          role,
          tokenHash: hashToken(rawToken),
          tokenPreview: rawToken.slice(-6),
          expiresAt,
        });
      },
    });
    if (!created.ok) return { ok: false, reason: "config" };

    revalidatePath(`/${locale}/admin/team`);
    return { ok: true, url: created.url };
  } catch (error) {
    console.error("[madaf/actions] createInviteAction failed:", error);
    return { ok: false };
  }
}

export async function revokeInviteAction(input: {
  inviteId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isUserId(input.inviteId)) return { ok: false };
    await revokeTenantInvite(input.inviteId);
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] revokeInviteAction failed:", error);
    return { ok: false };
  }
}

export async function updateMemberRoleAction(input: {
  userId: string;
  role: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isUserId(input.userId) || !isInviteRole(input.role)) {
      return { ok: false };
    }
    await updateMemberRole({ userId: input.userId, role: input.role });
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] updateMemberRoleAction failed:", error);
    return { ok: false };
  }
}

export async function removeMemberAction(input: {
  userId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isUserId(input.userId)) return { ok: false };
    await removeMember(input.userId);
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] removeMemberAction failed:", error);
    return { ok: false };
  }
}

export async function promoteOwnerAction(input: {
  userId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isUserId(input.userId)) return { ok: false };
    await promoteOwner(input.userId);
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] promoteOwnerAction failed:", error);
    return { ok: false };
  }
}

export async function demoteOwnerAction(input: {
  userId: string;
  role: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isUserId(input.userId) || !isInviteRole(input.role)) {
      return { ok: false };
    }
    await demoteOwner({ userId: input.userId, role: input.role });
    revalidatePath(`/${safeLocale(input.locale)}/admin/team`);
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] demoteOwnerAction failed:", error);
    return { ok: false };
  }
}

/** Why an invite acceptance failed — mapped to a localized message by the page. */
export type InviteFailReason =
  | "wrongEmail"
  | "alreadyMember"
  | "invalid"
  | "error";

function reasonFor(code: string | null): InviteFailReason {
  switch (code) {
    case "MDF06":
      return "wrongEmail";
    case "MDF07":
      return "alreadyMember";
    case "MDF02":
    case "MDF03":
    case "MDF04":
    case "MDF05":
    case "22023":
      return "invalid";
    default:
      return "error";
  }
}

export async function acceptInviteAction(input: {
  token: string;
  locale: string;
}): Promise<{ ok: true } | { ok: false; reason: InviteFailReason }> {
  try {
    if (typeof input.token !== "string" || input.token.length < 16) {
      return { ok: false, reason: "invalid" };
    }
    const result = await acceptInvite(input.token);
    if (result.ok) {
      revalidatePath(`/${safeLocale(input.locale)}`, "layout");
      return { ok: true };
    }
    return { ok: false, reason: reasonFor(result.code) };
  } catch (error) {
    console.error("[madaf/actions] acceptInviteAction failed:", error);
    return { ok: false, reason: "error" };
  }
}
