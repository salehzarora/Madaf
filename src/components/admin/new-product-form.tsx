"use client";

import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { ProductForm } from "@/components/admin/product-form";

/**
 * New-product form — thin wrapper over the shared ProductForm (create
 * mode). Mock mode shows the demo confirmation; Supabase mode persists.
 */
export function NewProductForm({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  return <ProductForm locale={locale} dict={dict} />;
}
