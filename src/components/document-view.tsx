"use client";

import { ArrowRight, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  defaultDocumentLocale,
  dirFor,
  localeNames,
  locales,
  type Locale,
} from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { formatCurrency, formatDateLong } from "@/lib/format";
import {
  customerById,
  productName,
  productById,
  supplier,
} from "@/lib/mock";
import type { Order, OrderDocument } from "@/lib/types";
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
  uiLocale,
}: {
  document: OrderDocument;
  order: Order;
  uiLocale: Locale;
}) {
  const [docLocale, setDocLocale] = useState<Locale>(defaultDocumentLocale);
  const t = getDictionary(docLocale).docs;
  const uiDict = getDictionary(uiLocale);

  const customer = customerById.get(order.customerId);
  const subtotal = order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  const vat = subtotal * VAT_RATE;

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
        <div className="flex items-start gap-3 rounded-field border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
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
            <span className="-rotate-30 select-none text-7xl font-black tracking-widest text-danger/10 sm:text-8xl">
              {t.draftWatermark}
            </span>
          </div>
        ) : null}

        {/* Header */}
        <header className="relative flex items-start justify-between gap-6 border-b-2 border-brand-700 pb-6">
          <div className="flex items-center gap-3">
            <LogoMark className="size-12" />
            <div>
              <p className="text-xl font-bold text-brand-800">
                {supplier.name[docLocale]}
              </p>
              <p className="text-xs text-ink-muted">{supplier.legalName}</p>
              <p className="text-xs text-ink-muted">
                {t.supplierIdLabel}: <span dir="ltr">{supplier.companyId}</span>
              </p>
            </div>
          </div>
          <div className="text-end">
            <h1 className="text-2xl font-bold text-ink">
              {t.types[document.type]}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {t.docNumber}: <span dir="ltr">{document.number}</span>
            </p>
            <p className="text-sm text-ink-soft">
              {t.orderRef}: <span dir="ltr">{order.number}</span>
            </p>
            <p className="text-sm text-ink-soft">
              {t.docDate}: {formatDateLong(document.date, docLocale)}
            </p>
          </div>
        </header>

        {/* Parties */}
        <section className="relative mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t.supplier}
            </p>
            <p className="font-semibold text-ink">{supplier.name[docLocale]}</p>
            <p className="text-ink-soft">{supplier.address[docLocale]}</p>
            <p className="text-ink-soft" dir="ltr">
              {supplier.phone}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t.billTo}
            </p>
            <p className="font-semibold text-ink">{customer?.name ?? "—"}</p>
            {customer ? (
              <>
                <p className="text-ink-soft">{customer.city[docLocale]}</p>
                <p className="text-ink-soft" dir="ltr">
                  {customer.phone}
                </p>
                <p className="text-ink-soft">{customer.contactName}</p>
              </>
            ) : null}
          </div>
        </section>

        {/* Items */}
        <section className="relative mt-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-strong text-xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 text-start font-semibold">{t.colItem}</th>
                <th className="w-16 py-2 text-center font-semibold">{t.colQty}</th>
                <th className="w-32 py-2 text-start font-semibold">{t.colUnit}</th>
                {showPrices ? (
                  <>
                    <th className="w-24 py-2 text-end font-semibold">
                      {t.colUnitPrice}
                    </th>
                    <th className="w-28 py-2 text-end font-semibold">
                      {t.colTotal}
                    </th>
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
                  <tr key={item.productId} className="border-b border-line/70">
                    <td className="py-2.5 text-ink">
                      {productName(product, docLocale)}
                      <span className="ms-2 text-xs text-ink-muted" dir="ltr">
                        {product.sku}
                      </span>
                    </td>
                    <td className="py-2.5 text-center tabular-nums text-ink">
                      {item.quantity}
                    </td>
                    <td className="py-2.5 text-ink-soft">
                      {dictForDoc.packaging[product.packageType]} ·{" "}
                      {product.unitsPerPackage}{" "}
                      {dictForDoc.units[product.baseUnit]}
                    </td>
                    {showPrices ? (
                      <>
                        <td className="py-2.5 text-end tabular-nums text-ink-soft">
                          {formatCurrency(item.unitPrice, docLocale)}
                        </td>
                        <td className="py-2.5 text-end font-medium tabular-nums text-ink">
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
            <div className="w-64 text-sm">
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
                  {formatCurrency(subtotal + vat, docLocale)}
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
          <footer className="relative mt-10 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
            {t.notLegalNotice}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
