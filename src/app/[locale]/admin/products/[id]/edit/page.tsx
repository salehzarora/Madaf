import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/components/admin/product-form";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { getDataMode, getInventoryForProduct, getProduct } from "@/lib/data";

/**
 * Edit an existing product. Supabase mode only — in mock mode there is
 * nothing to persist, so the route is not exposed (products table hides
 * the edit link). Rendered as a server component; the form is a client
 * component that submits through the product Server Actions.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  // Editing only makes sense against a real backend.
  if (getDataMode() !== "supabase") notFound();

  // Editing a product is owner/admin only (enforced server-side by
  // update_product). Gate the ROUTE too — deny a sales_rep BEFORE fetching any
  // edit-form data, so navigating straight here yields a 404, not a form (B1).
  const { userId, membership } = await getSessionContext();
  if (!userId) redirect(`/${locale}/login`);
  if (!membership) redirect(`/${locale}/onboarding`);
  // Explicit owner/admin allowlist (never default-allow on any other role).
  if (membership.role !== "owner" && membership.role !== "admin") notFound();

  const product = await getProduct(id);
  if (!product) notFound();
  const inventory = await getInventoryForProduct(id);
  const dict = getDictionary(locale);
  const t = dict.admin.products.new;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.editTitle}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.editSubtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <ProductForm
        locale={locale}
        dict={dict}
        product={product}
        inventory={inventory}
      />
    </div>
  );
}
