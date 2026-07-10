"use server";

/**
 * Customer (store/shop) write Server Actions (M7F.2).
 *
 * The only bridge between admin client components and the customer write
 * side of the data layer. Server Actions are public endpoints, so inputs
 * are re-validated here (shapes, bounds, lengths) AND again by the
 * create_customer / update_customer RPCs, which are the real gate —
 * owner/admin membership and the tenant are enforced in Postgres via
 * authorize_tenant. No client-supplied tenant_id is trusted.
 */
import { revalidatePath } from "next/cache";

import {
  createCustomer,
  searchCustomers,
  setCustomerActive,
  updateCustomer,
  type CustomerWriteInput,
} from "@/lib/data";
import {
  findCustomerDuplicates,
  type CustomerDuplicate,
} from "@/lib/data/customers";
import type { Customer, CustomerQuery, CustomerType } from "@/lib/types";

const MAX_NAME = 200;
const MAX_PHONE = 40;
const MAX_CITY = 120;
const MAX_ADDRESS = 300;
const MAX_NOTES = 2000;
const MAX_ID_LENGTH = 64;

const CUSTOMER_TYPES: readonly CustomerType[] = [
  "grocery",
  "kiosk",
  "supermarket",
  "minimarket",
];

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

/** Raw customer fields from the admin form → validated CustomerWriteInput. */
function readCustomerInput(raw: Record<string, unknown>): CustomerWriteInput | null {
  const name = str(raw.name, MAX_NAME);
  if (!name) return null;
  const type = CUSTOMER_TYPES.includes(raw.type as CustomerType)
    ? (raw.type as CustomerType)
    : "grocery";
  return {
    name,
    type,
    contactName: str(raw.contactName, MAX_NAME),
    phone: str(raw.phone, MAX_PHONE),
    cityAr: str(raw.cityAr, MAX_CITY),
    cityHe: str(raw.cityHe, MAX_CITY),
    cityEn: str(raw.cityEn, MAX_CITY),
    address: str(raw.address, MAX_ADDRESS),
    notes: str(raw.notes, MAX_NOTES),
  };
}

export interface CustomerWriteResult {
  ok: boolean;
  customerId?: string;
  /** Existing same-phone/name customers (M8B.3) — the admin must confirm
   * (confirmDuplicate: true) to create a look-alike store anyway. */
  duplicates?: CustomerDuplicate[];
}

/** Server page size for the customers list — mirrors the movements table. */
const CUSTOMERS_PAGE = 50;

export interface CustomerSearchResult {
  ok: boolean;
  customers?: Customer[];
  /** True when a full page came back — more pages may exist. */
  hasMore?: boolean;
}

/**
 * M8E.2 — server-side customer search + pagination. Filters run in the DB
 * query (RLS scopes rows to the caller's tenant). Inputs are re-validated;
 * an out-of-range offset or unknown facet is rejected/ignored. Read-only, so
 * every authenticated member may call it (RLS + the owner/admin link SELECT
 * policy already bound what they can see).
 */
export async function searchCustomersAction(input: {
  q?: string;
  status?: string;
  hasLink?: boolean;
  offset?: number;
}): Promise<CustomerSearchResult> {
  try {
    const offset = Number.isInteger(input.offset) ? (input.offset as number) : 0;
    if (offset < 0 || offset > 5_000_000) return { ok: false };

    const query: CustomerQuery = {};
    if (typeof input.q === "string" && input.q.trim()) {
      query.q = input.q.trim().slice(0, 120);
    }
    if (input.status === "active" || input.status === "inactive") {
      query.status = input.status;
    }
    if (typeof input.hasLink === "boolean") query.hasLink = input.hasLink;

    const customers = await searchCustomers(query, offset, CUSTOMERS_PAGE);
    return {
      ok: true,
      customers,
      hasMore: customers.length >= CUSTOMERS_PAGE,
    };
  } catch (error) {
    console.error("[madaf/actions] searchCustomersAction failed:", error);
    return { ok: false };
  }
}

function revalidateCustomers(locale: string): void {
  if (typeof locale !== "string" || !/^[a-z]{2}$/.test(locale)) return;
  revalidatePath(`/${locale}`, "layout"); // ShopDataProvider (customer pickers)
  revalidatePath(`/${locale}/admin/customers`);
  revalidatePath(`/${locale}/admin`);
}

export async function createCustomerAction(input: {
  customer: Record<string, unknown>;
  locale: string;
  confirmDuplicate?: boolean;
}): Promise<CustomerWriteResult> {
  try {
    const customer = readCustomerInput(input.customer);
    if (!customer) return { ok: false };

    if (input.confirmDuplicate !== true) {
      const duplicates = await findCustomerDuplicates({
        name: customer.name,
        phone: customer.phone,
      });
      if (duplicates.length > 0) {
        return { ok: false, duplicates: duplicates.slice(0, 5) };
      }
    }

    const result = await createCustomer(customer);
    revalidateCustomers(input.locale);
    return { ok: true, customerId: result.customerId };
  } catch (error) {
    console.error("[madaf/actions] createCustomerAction failed:", error);
    return { ok: false };
  }
}

/** M8C.3 — owner/admin deactivate/reactivate a store. The RPC is the gate. */
export async function setCustomerActiveAction(input: {
  customerId: string;
  active: boolean;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isPlausibleId(input.customerId) || typeof input.active !== "boolean") {
      return { ok: false };
    }
    await setCustomerActive(input.customerId, input.active);
    revalidateCustomers(input.locale);
    if (typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)) {
      revalidatePath(`/${input.locale}/admin/customers/${input.customerId}`);
    }
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] setCustomerActiveAction failed:", error);
    return { ok: false };
  }
}

export async function updateCustomerAction(input: {
  customerId: string;
  customer: Record<string, unknown>;
  locale: string;
}): Promise<CustomerWriteResult> {
  try {
    if (!isPlausibleId(input.customerId)) return { ok: false };
    const customer = readCustomerInput(input.customer);
    if (!customer) return { ok: false };
    const result = await updateCustomer(input.customerId, customer);
    revalidateCustomers(input.locale);
    revalidatePath(`/${input.locale}/admin/customers/${input.customerId}`);
    return { ok: true, customerId: result.customerId };
  } catch (error) {
    console.error("[madaf/actions] updateCustomerAction failed:", error);
    return { ok: false };
  }
}
