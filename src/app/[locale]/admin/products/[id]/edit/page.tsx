import { notFound } from "next/navigation";
import { ProductForm } from "@/components/admin/product-form";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
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

  const product = await getProduct(id);
  if (!product) notFound();
  const inventory = await getInventoryForProduct(id);
  const dict = getDictionary(locale);
  const t = dict.admin.products.new;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.editTitle}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t.editSubtitle}</p>
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
