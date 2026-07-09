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
