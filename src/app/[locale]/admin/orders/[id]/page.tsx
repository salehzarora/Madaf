import { ArrowRight, Download, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuestOrderCard } from "@/components/admin/guest-order-card";
import { OrderItemsEditor } from "@/components/admin/order-items-editor";
import { OrderStatusControl } from "@/components/order-status-control";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { getSessionContext } from "@/lib/auth/session";
import { orderSubtotal, productName } from "@/lib/catalog-helpers";
import {
  getCustomer,
  getDataMode,
  getOrder,
  listCategories,
  listDocumentsForOrder,
  listProducts,
} from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";

// Reads authenticated, tenant-scoped order data through the cookie-bound client,
// so it MUST render dynamically per request — never statically generated or
// cached. No generateStaticParams (which would mark the route SSG); force-dynamic.
export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const dict = getDictionary(locale);
  const t = dict.admin.orders.detail;
  // includeInactive: order lines keep referencing DEACTIVATED products —
  // they must still render (with the subtotal they're counted in), not
  // silently disappear (M8A). The items editor excludes inactive products
  // from its add-picker on its own.
  const [customer, orderDocs, products, categories] = await Promise.all([
    getCustomer(order.customerId),
    listDocumentsForOrder(order.id),
    listProducts({ includeInactive: true }),
    listCategories(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  // Latest document record per type, for the documents history/generate card.
  const docsByType = new Map(orderDocs.map((doc) => [doc.type, doc]));
  const live = getDataMode() === "supabase";
  // M8D: status changes, item editing and guest promotion are owner/admin
  // (the RPCs enforce it). A sales_rep can VIEW an assigned order but not
  // manage it — hide/disable those actions instead of showing failing ones.
  const role = live ? (await getSessionContext()).membership?.role : null;
  const canManage = !live || role === "owner" || role === "admin";
  // Guest (showcase) order — no linked shop, buyer details in the snapshot (M7I).
  const guest =
    !customer && order.customerSnapshot?.name ? order.customerSnapshot : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <Link
          href={`/${locale}/admin/orders`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
          {dict.admin.orders.title}
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-ink">
            {t.title}
          </h1>
          <span
            dir="ltr"
            className="font-mono text-lg font-semibold text-brand-700"
            title={t.internalRef}
          >
            {order.number}
          </span>
          <span className="text-xs text-ink-muted">{t.internalRef}</span>
          {order.publicRef ? (
            <span
              dir="ltr"
              className="rounded-badge bg-surface-sunken px-2 py-0.5 font-mono text-xs text-ink-soft"
            >
              {t.customerRef}: {order.publicRef}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {t.placedOn} {formatDate(order.createdAt, locale)} ·{" "}
          {interpolate(t.itemsCount, { count: order.items.length })}
        </p>
        <ShelfRule className="mt-4" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {/* Status pipeline */}
          <Card>
            <CardHeader>
              <CardTitle>{t.statusTitle}</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <OrderStatusControl
                orderId={order.id}
                initialStatus={order.status}
                locale={locale}
                live={live}
                canManage={canManage}
                dict={dict}
              />
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>{t.itemsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ul className="divide-y divide-line-hair">
                {order.items.map((item) => {
                  // includeInactive map ⇒ deactivated products still resolve.
                  // A truly missing row (hard-deleted) renders a fallback line
                  // instead of vanishing — the subtotal counts it (M8A).
                  const product = productById.get(item.productId);
                  const category = product
                    ? categoryById.get(product.categoryId)
                    : undefined;
                  return (
                    <li
                      key={item.productId}
                      className="flex items-center gap-3 py-3"
                    >
                      {product ? (
                        <ProductImage
                          product={product}
                          category={category}
                          className="size-11 shrink-0 rounded-field"
                          iconClassName="size-5"
                          showSizeTag={false}
                        />
                      ) : (
                        <span className="size-11 shrink-0 rounded-field bg-surface-sunken" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {product
                            ? productName(product, locale)
                            : t.unavailableProduct}
                        </p>
                        <p className="text-xs text-ink-muted" dir="ltr">
                          {formatCurrency(item.unitPrice, locale)} ×{" "}
                          {item.quantity}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums text-ink">
                        {formatCurrency(item.unitPrice * item.quantity, locale)}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex justify-between border-t border-line pt-3 text-base font-bold text-ink">
                <span>{dict.common.subtotal}</span>
                <span className="tabular-nums">
                  {formatCurrency(orderSubtotal(order), locale)}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{dict.cart.vatNote}</p>
            </CardContent>
          </Card>

          {/* Edit lines (M7I.3) — owner/admin only; RPC reconciles reserved stock */}
          <OrderItemsEditor
            order={order}
            products={products}
            categories={categories}
            locale={locale}
            live={live && canManage}
            dict={dict}
          />
        </div>

        <div className="flex flex-col gap-4">
          {/* Shop — a linked customer, or a guest (showcase) order snapshot (M7I) */}
          {guest ? (
            <GuestOrderCard
              orderId={order.id}
              snapshot={guest}
              locale={locale}
              live={live && canManage}
              dict={dict}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t.shopTitle}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 pt-3 text-sm">
                <p className="text-base font-semibold text-ink">
                  {customer?.name ?? "—"}
                </p>
                {customer ? (
                  <>
                    <p className="text-ink-soft">
                      {dict.admin.customers.types[customer.type]} ·{" "}
                      {customer.city[locale]}
                    </p>
                    <p className="text-ink-soft" dir="ltr">
                      {customer.phone}
                    </p>
                    <p className="text-ink-soft">{customer.contactName}</p>
                  </>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>{t.notesTitle}</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 text-sm leading-relaxed text-ink-soft">
              {order.notes ?? (
                <span className="text-ink-muted">{t.noNotes}</span>
              )}
            </CardContent>
          </Card>

          {/* Documents — history + generate/download/regenerate (M5B).
              Access is enforced server-side: this page only renders for
              orders the member can access, and the download route re-checks
              (RLS + can_access_order) before generating/signing. */}
          <Card>
            <CardHeader>
              <CardTitle>{t.previewDoc}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-3">
              {(["order", "delivery", "invoiceDraft"] as const).map(
                (docType) => {
                  const existing = docsByType.get(docType);
                  const base = `/${locale}/admin/orders/${order.id}/documents/${docType}`;
                  const isDraft = docType === "invoiceDraft";
                  return (
                    <div
                      key={docType}
                      className={
                        isDraft
                          ? "rounded-field border border-dashed border-warning/45 bg-accent-wash p-3"
                          : "rounded-field border border-line bg-surface-warm p-3"
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <FileText
                          className="size-4 text-brand-600"
                          aria-hidden
                        />
                        <span className="text-sm font-bold text-ink">
                          {dict.docs.types[docType]}
                        </span>
                        {existing?.status ? (
                          <Badge
                            tone={isDraft ? "warning" : "neutral"}
                            dashed={isDraft}
                          >
                            {dict.docs.status[existing.status]}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {existing ? (
                          <>
                            <span dir="ltr" className="font-mono">
                              {existing.number}
                            </span>
                            {" · "}
                            {dict.docs.docDate}:{" "}
                            {formatDate(
                              existing.generatedAt ?? existing.date,
                              locale,
                            )}
                          </>
                        ) : (
                          dict.docs.notGenerated
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <a
                          href={base}
                          className="inline-flex h-9 items-center gap-1.5 rounded-field bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                        >
                          <Download className="size-4" aria-hidden />
                          {dict.docs.downloadPdf}
                        </a>
                        {existing ? (
                          <a
                            href={`${base}?regenerate=1`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line px-3 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
                          >
                            <RefreshCw className="size-4" aria-hidden />
                            {dict.docs.regenerate}
                          </a>
                        ) : null}
                        {existing ? (
                          <Link
                            href={`/${locale}/admin/documents/${existing.id}`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field px-3 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
                          >
                            {dict.docs.preview}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  );
                },
              )}

              {/* Permanent legal notice: drafts are previews, not tax invoices. */}
              <p className="text-xs leading-relaxed text-ink-soft">
                {dict.admin.documents.legalBanner}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
