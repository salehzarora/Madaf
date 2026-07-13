"use client";

import { ArrowRight, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShelfRule } from "@/components/ui/shelf-rule";
import {
  defaultDocumentLocale,
  dirFor,
  localeNames,
  locales,
  type Locale,
} from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import { formatTenantDateLong } from "@/lib/time";
import { useShopData } from "@/lib/shop-data-context";
import type { Order, OrderDocument, Supplier } from "@/lib/types";
import { VAT_RATE } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Printable document preview (A4-ish sheet).
 *
 * LEGAL RULES (docs/DOCUMENTS_AND_INVOICES_GUIDE.md):
 * - "invoiceDraft" always renders a DRAFT watermark + not-legal notice.
 * - Nothing here may present itself as a legally issued tax invoice.
 * - Documents default to Hebrew regardless of UI locale; the viewer can
 *   switch the DOCUMENT language independently.
 */
export function DocumentView({
  document,
  order,
  supplier,
  uiLocale,
}: {
  document: OrderDocument;
  order: Order;
  supplier: Supplier;
  uiLocale: Locale;
}) {
  const [docLocale, setDocLocale] = useState<Locale>(defaultDocumentLocale);
  const t = getDictionary(docLocale).docs;
  const uiDict = getDictionary(uiLocale);
  const { productById, customerById } = useShopData();

  // Buyer: a linked store, else the GUEST snapshot (M7I orders have no
  // customerId). M8E.5 — the preview now shows the guest snapshot exactly like
  // the PDF, instead of a blank "—".
  const linkedCustomer = order.customerId
    ? customerById.get(order.customerId)
    : undefined;
  const snap = order.customerSnapshot;
  const buyer = linkedCustomer
    ? {
        name: linkedCustomer.name,
        city: linkedCustomer.city[docLocale],
        phone: linkedCustomer.phone,
        contactName: linkedCustomer.contactName,
      }
    : snap
      ? {
          name: snap.name ?? "—",
          city: snap.city?.[docLocale] ?? "",
          phone: snap.phone ?? "",
          contactName: snap.contactName ?? "",
        }
      : null;

  // Totals: use the SERVER-STORED order totals when present (supabase) so the
  // preview matches the PDF exactly (M8E.5); otherwise recompute with the
  // tenant's DISPLAY VAT rate (a non-legal estimate; falls back to VAT_RATE).
  const vatRate = supplier.displayVatRate ?? VAT_RATE;
  const computedSubtotal = order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  const subtotal = order.subtotal ?? computedSubtotal;
  const vat = order.vatTotal ?? computedSubtotal * vatRate;
  const grandTotal = order.total ?? subtotal + vat;

  const isInvoiceDraft = document.type === "invoiceDraft";
  const isDelivery = document.type === "delivery";
  const showPrices = !isDelivery;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar — hidden when printing */}
      <div className="print-hidden flex flex-wrap items-center gap-3">
        <Link
          href={`/${uiLocale}/admin/documents`}
          className="inline-flex h-10 items-center gap-1.5 rounded-field px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" aria-hidden />
          {uiDict.docs.backToDocuments}
        </Link>

        <div className="ms-auto flex items-center gap-3">
          <span className="text-xs text-ink-muted">{uiDict.docs.docLanguage}</span>
          <div className="flex items-center rounded-full border border-line bg-surface-sunken p-1">
            {locales.map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => setDocLocale(locale)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  locale === docLocale
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {localeNames[locale]}
              </button>
            ))}
          </div>
          <Button onClick={() => window.print()} variant="outline" size="sm">
            <Printer className="size-4" aria-hidden />
            {uiDict.docs.printAction}
          </Button>
        </div>
      </div>

      {/* Not-legal notice for invoice drafts — also printed, on purpose */}
      {isInvoiceDraft ? (
        <div className="flex items-start gap-3 rounded-field border border-dashed border-warning/50 bg-accent-wash px-4 py-3 text-[13px] font-medium text-accent-deep">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{uiDict.docs.notLegalNotice}</p>
        </div>
      ) : null}

      {/* The sheet */}
      <div
        dir={dirFor(docLocale)}
        lang={docLocale}
        className="doc-sheet relative mx-auto overflow-hidden rounded-card border border-line p-8 shadow-card sm:p-10"
      >
        {/* DRAFT watermark */}
        {isInvoiceDraft ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="-rotate-30 select-none rounded-2xl border-[6px] border-danger/[.07] px-10 py-2 text-6xl font-black tracking-[0.12em] text-danger/[.07] sm:text-[100px]">
              {t.draftWatermark}
            </span>
          </div>
        ) : null}

        {/* Header */}
        <header className="relative flex items-start justify-between gap-6 pb-6">
          <div className="flex items-center gap-3">
            {supplier.logoUrl ? (
              // Tenant business logo (M8E.4) when set; else the app mark.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={supplier.logoUrl}
                alt=""
                className="size-[52px] rounded-field border border-line object-contain"
              />
            ) : (
              <LogoMark className="size-[52px]" />
            )}
            <div>
              <p className="text-[22px] font-extrabold text-brand-950">
                {supplier.name[docLocale]}
              </p>
              <p className="text-xs text-ink-soft">{supplier.legalName}</p>
              <p className="text-xs text-ink-soft">
                {t.supplierIdLabel}:{" "}
                <span dir="ltr" className="font-mono">
                  {supplier.companyId}
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end text-end">
            {isInvoiceDraft ? (
              <Badge tone="warning" dashed dot className="mb-1.5">
                {t.draftWatermark}
              </Badge>
            ) : null}
            <h1 className="text-2xl font-bold text-ink">
              {t.types[document.type]}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {t.docNumber}:{" "}
              <span dir="ltr" className="font-mono font-semibold ps-1">
                {document.number}
              </span>
            </p>
            <p className="text-sm text-ink-soft">
              {t.orderRef}:{" "}
              <span dir="ltr" className="font-mono font-semibold ps-1">
                {/* Customer-facing document → public ref, never the internal
                    sequential number (M7G). Supabase always has publicRef;
                    mock has no internal sequence so its number doubles as it. */}
                {order.publicRef ?? order.number}
              </span>
            </p>
            <p className="text-sm text-ink-soft">
              {/* M8H.2 — the document date is the SUPPLIER's business date: an
                  absolute instant rendered in the TENANT's timezone, never the
                  viewer's device zone. */}
              {t.docDate}:{" "}
              {formatTenantDateLong(document.date, docLocale, supplier.timezone)}
            </p>
          </div>
        </header>
        <ShelfRule className="relative" />

        {/* Parties */}
        <section className="relative mt-6 grid grid-cols-2 gap-6 text-sm">
          <div className="border-s-[3px] border-line ps-3.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t.supplier}
            </p>
            <p className="font-semibold text-ink">{supplier.name[docLocale]}</p>
            <p className="text-ink-soft">{supplier.address[docLocale]}</p>
            <p className="text-ink-soft" dir="ltr">
              {supplier.phone}
            </p>
          </div>
          <div className="border-s-[3px] border-brand-600 ps-3.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t.billTo}
            </p>
            <p className="font-semibold text-ink">{buyer?.name ?? "—"}</p>
            {buyer ? (
              <>
                {buyer.city ? (
                  <p className="text-ink-soft">{buyer.city}</p>
                ) : null}
                {buyer.phone ? (
                  <p className="text-ink-soft" dir="ltr">
                    {buyer.phone}
                  </p>
                ) : null}
                {buyer.contactName ? (
                  <p className="text-ink-soft">{buyer.contactName}</p>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        {/* Items */}
        <section className="relative mt-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-3 py-2.5 text-start">{t.colItem}</th>
                <th className="w-16 px-3 py-2.5 text-center">{t.colQty}</th>
                <th className="w-32 px-3 py-2.5 text-start">{t.colUnit}</th>
                {showPrices ? (
                  <>
                    <th className="w-24 px-3 py-2.5 text-end">
                      {t.colUnitPrice}
                    </th>
                    <th className="w-28 px-3 py-2.5 text-end">{t.colTotal}</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const product = productById.get(item.productId);
                if (!product) return null;
                const dictForDoc = getDictionary(docLocale);
                return (
                  <tr
                    key={item.productId}
                    className="border-b border-line-hair last:border-0"
                  >
                    <td className="px-3 py-2.5 text-ink">
                      <span className="inline-flex flex-wrap items-baseline gap-2">
                        <span>{productName(product, docLocale)}</span>
                        <span className="font-mono text-xs text-ink-muted" dir="ltr">
                          {product.sku}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono font-semibold text-ink">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-2.5 text-ink-soft">
                      {dictForDoc.packaging[product.packageType]} ·{" "}
                      {product.unitsPerPackage}{" "}
                      {dictForDoc.units[product.baseUnit]}
                    </td>
                    {showPrices ? (
                      <>
                        <td className="px-3 py-2.5 text-end tabular-nums text-ink-soft">
                          {formatCurrency(item.unitPrice, docLocale)}
                        </td>
                        <td className="px-3 py-2.5 text-end font-medium tabular-nums text-ink">
                          {formatCurrency(
                            item.unitPrice * item.quantity,
                            docLocale,
                          )}
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* Totals (order + invoice draft) */}
        {showPrices ? (
          <section className="relative mt-6 flex justify-end">
            <div className="w-[280px] text-sm">
              <ShelfRule className="mb-2" />
              <div className="flex justify-between py-1.5 text-ink-soft">
                <span>{t.subtotal}</span>
                <span className="tabular-nums">
                  {formatCurrency(subtotal, docLocale)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 text-ink-soft">
                <span>{t.vatEstimate}</span>
                <span className="tabular-nums">
                  {formatCurrency(vat, docLocale)}
                </span>
              </div>
              <div className="flex justify-between border-t-2 border-brand-700 py-2 text-base font-bold text-ink">
                <span>{t.totalEstimate}</span>
                <span className="tabular-nums">
                  {formatCurrency(grandTotal, docLocale)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t.vatDisclaimer}
              </p>
            </div>
          </section>
        ) : null}

        {/* Notes */}
        {order.notes ? (
          <section className="relative mt-6 rounded-field bg-surface-sunken p-4 text-sm text-ink-soft">
            {order.notes}
          </section>
        ) : null}

        {/* Delivery signature block */}
        {isDelivery ? (
          <section className="relative mt-12 grid grid-cols-2 gap-10 text-sm">
            <div>
              <p className="mb-8 text-ink-muted">{t.receivedBy}</p>
              <div className="border-b border-ink/40" />
            </div>
            <div>
              <p className="mb-8 text-ink-muted">{t.signature}</p>
              <div className="border-b border-ink/40" />
            </div>
          </section>
        ) : null}

        {/* Footer note on invoice drafts, inside the printed sheet */}
        {isInvoiceDraft ? (
          <footer className="relative mt-10 border-t border-line-hair pt-4 text-xs leading-relaxed text-ink-soft">
            {t.notLegalNotice}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
