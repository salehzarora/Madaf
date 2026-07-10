/**
 * Customer (shop) data access. Mock by default; Supabase branch is
 * server-only local dev (see ./supabase-reads for the access model).
 */
import { customerById, customers } from "@/lib/mock";
import type { Customer, CustomerType } from "@/lib/types";

import { getDataMode } from "./mode";

export async function listCustomers(): Promise<Customer[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListCustomers();
  }
  return customers;
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetCustomer(id);
  }
  return customerById.get(id);
}

// ── Duplicate detection (M8B.3) ────────────────────────────────────────────

/** Digits-only phone, Israeli-prefix folded: "+972 50-123…" ≡ "050123…". */
function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00972")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return digits.length >= 7 ? digits : null;
}

function normalizeName(value: string | undefined): string | null {
  if (!value) return null;
  const collapsed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return collapsed || null;
}

export interface CustomerDuplicate {
  id: string;
  name: string;
  phone?: string;
  city: { ar: string; he: string; en: string };
  /** "phone" = same normalized phone (strong); "name" = same name (soft). */
  matchType: "phone" | "name";
}

/**
 * Tenant-scoped duplicate check before creating a customer (M8B.3) — used
 * by guest-order promotion, signup approval and the manual create form.
 * Runs on the caller's own RLS-scoped customer list (never cross-tenant).
 * Phone matches sort first (strongest signal).
 */
export async function findCustomerDuplicates(input: {
  name?: string;
  phone?: string;
}): Promise<CustomerDuplicate[]> {
  const phone = normalizePhone(input.phone);
  const name = normalizeName(input.name);
  if (!phone && !name) return [];
  const all = await listCustomers();
  const out: CustomerDuplicate[] = [];
  for (const c of all) {
    const matchType =
      phone && normalizePhone(c.phone) === phone
        ? ("phone" as const)
        : name && normalizeName(c.name) === name
          ? ("name" as const)
          : null;
    if (!matchType) continue;
    out.push({
      id: c.id,
      name: c.name,
      phone: c.phone || undefined,
      city: c.city,
      matchType,
    });
  }
  return out.sort((a, b) =>
    a.matchType === b.matchType ? 0 : a.matchType === "phone" ? -1 : 1,
  );
}

// ── Writes (M7F.2) — supabase-only, via create_customer / update_customer ──

export interface CustomerWriteInput {
  name: string;
  type: CustomerType;
  contactName?: string;
  phone?: string;
  cityAr?: string;
  cityHe?: string;
  cityEn?: string;
  address?: string;
  notes?: string;
}

/**
 * Customer writes exist only in supabase mode. In mock mode the admin form
 * shows a demo message and never calls these (it gates on getDataMode).
 */
function mockCustomerWriteUnsupported(fn: string): never {
  throw new Error(
    `[madaf/data] ${fn} is a Supabase-only write — mock mode does not ` +
      "persist. Run in supabase mode or keep the admin form in demo mode.",
  );
}

export async function createCustomer(
  input: CustomerWriteInput,
): Promise<{ customerId: string }> {
  if (getDataMode() !== "supabase") mockCustomerWriteUnsupported("createCustomer");
  return (await import("./supabase-writes")).sbCreateCustomer(input);
}

export async function updateCustomer(
  customerId: string,
  input: CustomerWriteInput,
): Promise<{ customerId: string }> {
  if (getDataMode() !== "supabase") mockCustomerWriteUnsupported("updateCustomer");
  return (await import("./supabase-writes")).sbUpdateCustomer(customerId, input);
}
