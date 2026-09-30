import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import type { Locale } from "@/i18n/config";
import { getOrder, getSupplier, listCustomers, listProducts } from "@/lib/data";
import { ShopDataProvider } from "@/lib/shop-data-context";
import type { OrderDocument } from "@/lib/types";

/** The existing HTML preview and its route-local, tenant-scoped reference data. */
export async function DocumentPreview({
  document,
  locale,
  autoPrint = false,
}: {
  document: OrderDocument;
  locale: Locale;
  autoPrint?: boolean;
}) {
  const order = await getOrder(document.orderId);
  if (!order) notFound();
  const [supplier, products, customers] = await Promise.all([
    getSupplier(),
    listProducts(),
    listCustomers(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <ShopDataProvider products={products} categories={[]} manufacturers={[]} customers={customers}>
        <DocumentView document={document} order={order} supplier={supplier} uiLocale={locale} autoPrint={autoPrint} />
      </ShopDataProvider>
    </div>
  );
}
