/** Exercise the real server page while isolating its read boundary. A private
 * anonymous catalog must return before supplier data is read; an authorized
 * page may pass display identity only to the client component. */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { Supplier } from "@/lib/types";

let mode: "mock" | "supabase" = "supabase";
let membership: { tenantId: string } | null = null;
const reads: string[] = [];
const supplier: Supplier = {
  id: "tenant-test",
  name: { ar: "مورّد اختبار", he: "ספק בדיקה", en: "Test supplier" },
  logoUrl: "https://example.test/display-logo.png",
  logoStoragePath: "tenant-test/private-logo-path",
  legalName: "Private legal identity",
  companyId: "private-company-id",
  phone: "private-phone",
  email: "private@example.test",
  address: { ar: "private-address", he: "private-address", en: "private-address" },
  displayVatRate: 0.18,
  timezone: "Asia/Jerusalem",
};

mock.module("next/navigation", {
  namedExports: { notFound: () => { throw new Error("not-found"); } },
});
mock.module("@/components/catalog-view", {
  namedExports: { CatalogView: () => null },
});
mock.module("@/lib/auth/session", {
  namedExports: {
    getSessionContext: async () => {
      reads.push("membership");
      return { membership };
    },
  },
});
mock.module("@/lib/data", {
  namedExports: {
    getDataMode: () => mode,
    getSupplier: async () => {
      reads.push("supplier");
      return supplier;
    },
  },
});

const { default: CatalogPage } = await import("@/app/[locale]/(shop)/catalog/page");

beforeEach(() => {
  mode = "supabase";
  membership = null;
  reads.length = 0;
});

test("a private catalog without membership never reads or serializes supplier identity", async () => {
  const page = await CatalogPage({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve({ customer: "untrusted-customer" }),
  });
  assert.deepEqual(reads, ["membership"]);
  assert.equal(page.type, "main", "the existing private-link explainer remains the response");
  assert.equal("supplier" in page.props, false);
});

for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: membership is checked before reading supplier; only localized name and display logo cross the boundary`, async () => {
    membership = { tenantId: "tenant-test" };
    const page = await CatalogPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ customer: "deep-linked-customer" }),
    });
    assert.deepEqual(reads, ["membership", "supplier"]);
    assert.deepEqual(page.props.supplier, { name: supplier.name[locale], logoUrl: supplier.logoUrl });
    assert.equal(page.props.initialCustomerId, "deep-linked-customer");
    assert.equal(page.props.locale, locale);
  });
}

test("zero-config mock catalog reads display identity without an authentication lookup", async () => {
  mode = "mock";
  const page = await CatalogPage({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve({}),
  });
  assert.deepEqual(reads, ["supplier"]);
  assert.deepEqual(page.props.supplier, { name: supplier.name.en, logoUrl: supplier.logoUrl });
});

test("an invalid locale fails before any supplier or membership read", async () => {
  await assert.rejects(CatalogPage({
    params: Promise.resolve({ locale: "invalid" }),
    searchParams: Promise.resolve({}),
  }), /not-found/);
  assert.deepEqual(reads, []);
});
