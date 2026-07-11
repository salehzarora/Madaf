import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import { isLocale } from "@/i18n/config";
import {
  getDocument,
  getOrder,
  getSupplier,
  listCustomers,
  listProducts,
} from "@/lib/data";
import { ShopDataProvider } from "@/lib/shop-data-context";

// Reads authenticated, tenant-scoped document data through the cookie-bound
// client, so it MUST render dynamically per request — never statically
// generated or cached. No generateStaticParams (which would mark the route SSG);
// force-dynamic. Legal/document wording is unchanged.
export const dynamic = "force-dynamic";

/**
 * Hebrew-first document preview. The DocumentView client component owns
 * the document-language toggle and all legal-wording rules.
 */
export default async function AdminDocumentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const doc = await getDocument(id);
  if (!doc) notFound();
  // The admin layout hydrates only category/manufacturer reference data (M8F.2);
  // the document preview resolves line-item product + customer names via
  // useShopData, so provide those two collections LOCALLY on THIS route (the
  // same data the root layout used to supply globally). Scoped here so admin
  // list routes never receive the full catalog.
  const [order, supplier, products, customers] = await Promise.all([
    getOrder(doc.orderId),
    getSupplier(),
    listProducts(),
    listCustomers(),
  ]);
  if (!order) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <ShopDataProvider
        products={products}
        categories={[]}
        manufacturers={[]}
        customers={customers}
      >
        <DocumentView
          document={doc}
          order={order}
          supplier={supplier}
          uiLocale={locale}
        />
      </ShopDataProvider>
    </div>
  );
}
