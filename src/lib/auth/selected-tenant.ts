import "server-only";

/**
 * The "selected tenant" cookie (M4C). A signed-in user may belong to several
 * tenants; this cookie remembers which one the admin UI is currently acting
 * on. It is httpOnly and read server-side, and — crucially — it is NEVER
 * trusted on its own: `getSessionContext` only honours it when its value is
 * one of the caller's real memberships, and every write RPC re-verifies
 * membership for the tenant it is given. A tampered/stale cookie therefore
 * just falls back to the first membership; it can never grant cross-tenant
 * access.
 */
import { cookies } from "next/headers";

export const SELECTED_TENANT_COOKIE = "madaf_tenant";

/** Read the selected-tenant cookie (RSC-safe). */
export async function readSelectedTenant(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SELECTED_TENANT_COOKIE)?.value;
}

/** Set the selected-tenant cookie — ONLY from a Server Action / Route Handler. */
export async function writeSelectedTenant(tenantId: string): Promise<void> {
  const store = await cookies();
  store.set(SELECTED_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}
