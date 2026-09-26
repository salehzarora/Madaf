"use client";

import {
  CheckCircle2,
  Lock,
  PackageSearch,
  Plus,
  ShoppingCart,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { CatalogFilterBar } from "@/components/shop/catalog-filter-bar";
import { EmptyState } from "@/components/empty-state";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import {
  emptyCatalogFilters,
  filterAndSortProducts,
} from "@/lib/catalog-filter";
import { formatCurrency, formatNumber } from "@/lib/format";
import { submitShopOrderAction } from "@/lib/actions/shop";
import {
  clearTokenSubmissionKey,
  getOrCreateTokenSubmissionKey,
  rotateTokenSubmissionKey,
} from "@/lib/client/order-submission-key";
import type { TokenCatalog } from "@/lib/data/token";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Used when a product's category isn't in the token catalog payload. */
const FALLBACK_CATEGORY: Category = {
  id: "misc",
  name: { ar: "", he: "", en: "" },
  icon: "📦",
  hue: 0,
};

/**
 * Self-contained tokenized storefront for a shop opening its private link.
 * No login, no global cart — the cart is local state and the order is
 * submitted through the token action. The store/customer is fixed by the
 * token and is READ-ONLY (the buyer can never change who the order is for).
 */
export function ShopView({
  locale,
  dict,
  token,
  catalog,
}: {
  locale: Locale;
  dict: Dictionary;
  token: string;
  catalog: TokenCatalog;
}) {
  const t = dict.access.shop;
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  // Customer-facing PUBLIC ref (MDF-XXXXXXXX), never the internal number.
  const [publicRef, setPublicRef] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);
  // FIX2: could not safely prepare a persistent submission key (browser storage
  // unavailable) — fail closed, do NOT submit (a volatile key would risk a
  // duplicate order after refresh).
  const [prepFailed, setPrepFailed] = useState(false);
  const [filters, setFilters] = useState(emptyCatalogFilters);

  const categoryById = useMemo(
    () => new Map(catalog.categories.map((c) => [c.id, c])),
    [catalog.categories],
  );
  const manufacturerById = useMemo(
    () => new Map(catalog.manufacturers.map((m) => [m.id, m])),
    [catalog.manufacturers],
  );
  const visible = useMemo(
    () => filterAndSortProducts(catalog.products, filters, manufacturerById, locale),
    [catalog.products, filters, manufacturerById, locale],
  );

  function setQty(productId: string, qty: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  const lineCount = cart.size;
  const estimate = useMemo(() => {
    let sum = 0;
    for (const product of catalog.products) {
      const qty = cart.get(product.id);
      if (qty) sum += qty * product.wholesalePrice;
    }
    return sum;
  }, [cart, catalog.products]);

  function onSubmit() {
    setError(false);
    setConflict(false);
    setPrepFailed(false);
    const items = [...cart.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
    if (items.length === 0) return;
    startTransition(async () => {
      // FIX2: one submission key per logical order, PERSISTED in sessionStorage
      // (scoped to this token) so a refresh/remount retry reuses it. Fail closed
      // if storage is unavailable — do NOT submit with a volatile key.
      const keyResult = await getOrCreateTokenSubmissionKey("shop_token", token);
      if (!keyResult.ok) {
        setPrepFailed(true);
        return;
      }
      try {
        const result = await submitShopOrderAction({
          token,
          items,
          notes: notes.trim() || undefined,
          submissionKey: keyResult.key,
        });
        if (result.ok && result.publicRef) {
          setPublicRef(result.publicRef);
          setCart(new Map());
          setNotes("");
          await clearTokenSubmissionKey("shop_token", token); // next order = new key
        } else if (result.reason === "conflict") {
          setConflict(true); // key reused with a changed order; keep the cart + key
        } else {
          setError(true); // keep the key — a retry reuses it
        }
      } catch {
        // Ambiguous transport/server-action failure: KEEP the persisted key so the
        // retry is the same logical order (the DB returns the original if it committed).
        setError(true);
      }
    });
  }

  // Explicit new attempt after a conflict: rotate the persisted key, keep the cart.
  function startNewAttempt() {
    void rotateTokenSubmissionKey("shop_token", token);
    setConflict(false);
    setError(false);
    setPrepFailed(false);
  }

  const tenantName = catalog.tenantName[locale] || catalog.tenantName.he;

  if (publicRef) {
    return (
      <main className="storefront-theme private-shop private-shop-terminal private-shop-success">
        <div className="private-shop-terminal-panel">
          <CheckCircle2 className="private-shop-success-icon" aria-hidden />
          <h1>{t.successTitle}</h1>
          <p className="private-shop-terminal-body">{t.successBody}</p>
          <div className="private-shop-reference">
            <p>{t.orderNumberLabel}</p>
            <p className="private-shop-reference-value" dir="ltr">
              {publicRef}
            </p>
          </div>
          <p className="private-shop-terminal-hint">{t.refHint}</p>
          <p className="private-shop-disclaimer">{t.disclaimer}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="storefront-theme private-shop">
      {/* Header — supplier + read-only store context */}
      <header className="private-shop-header">
        <div className="private-shop-header-inner">
          {catalog.tenantLogoUrl ? (
            // Supplier business logo (M8E.1) — signed URL; graceful fallback to
            // name-only when absent or signing failed.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalog.tenantLogoUrl}
              alt=""
              className="private-shop-supplier-logo"
            />
          ) : null}
          <div className="private-shop-supplier">
            <p>{t.welcome}</p>
            <h1>
              {tenantName}
            </h1>
          </div>
          <div className="private-shop-locale">
            <LocaleSwitcher current={locale} label={dict.common.language} variant="compact" />
          </div>
        </div>
        <div className="private-shop-context-wrap">
          <div className="private-shop-context">
            <Lock className="private-shop-lock" aria-hidden />
            <span className="private-shop-context-label">{t.orderingFor}</span>
            <span className="private-shop-customer-name">
              {catalog.customer.name}
            </span>
            {catalog.customer.city[locale] ? (
              <span className="private-shop-customer-city">
                · {catalog.customer.city[locale]}
              </span>
            ) : null}
            <span className="private-shop-locked-hint">
              {t.storeLocked}
            </span>
          </div>
        </div>
      </header>

      <main className="private-shop-main">
        {catalog.products.length > 0 ? (
          <CatalogFilterBar
            className="private-shop-filter-bar"
            locale={locale}
            dict={dict}
            categories={catalog.categories}
            manufacturers={catalog.manufacturers}
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters(emptyCatalogFilters())}
          />
        ) : null}

        {catalog.products.length === 0 ? (
          <EmptyState className="private-shop-empty" icon={<PackageSearch />} title={t.empty} />
        ) : visible.length === 0 ? (
          <EmptyState
            className="private-shop-empty"
            icon={<PackageSearch />}
            title={dict.catalog.noResults}
            hint={dict.catalog.noResultsHint}
          />
        ) : (
          <div className="private-shop-grid">
            {visible.map((product) => {
              const qty = cart.get(product.id) ?? 0;
              const soldOut = product.availability === "outOfStock";
              const category =
                categoryById.get(product.categoryId) ?? FALLBACK_CATEGORY;
              const manufacturer = manufacturerById.get(product.manufacturerId);
              return (
                <div
                  key={product.id}
                  className={cn(
                    "private-shop-product",
                    qty > 0 && "private-shop-product-selected",
                  )}
                >
                  <ProductImage
                    product={product}
                    category={category}
                    presentation="storefront"
                    className="private-shop-product-media"
                  />
                  <div className="private-shop-product-copy">
                    <h3>
                      {productName(product, locale)}
                    </h3>
                    {manufacturer ? (
                      <p className="private-shop-product-brand">
                        {manufacturer.name[locale]}
                      </p>
                    ) : null}
                    <p className="private-shop-product-package">
                      {packageLabel(product, dict)}
                    </p>
                    <p className="private-shop-product-price" dir="ltr">
                      {formatCurrency(product.wholesalePrice, locale)}
                    </p>
                  </div>
                  <div className="private-shop-product-action">
                    {soldOut && qty > 0 ? (
                      <p className="private-shop-sold-out">{dict.availability.outOfStock}</p>
                    ) : null}
                    {qty > 0 ? (
                      <QuantityStepper
                        value={qty}
                        increaseDisabled={soldOut}
                        onChange={(next) => setQty(product.id, next)}
                        className="private-shop-quantity"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQty(product.id, 1)}
                        disabled={soldOut}
                        className="private-shop-add"
                      >
                        {soldOut ? (
                          dict.availability.outOfStock
                        ) : (
                          <>
                            <Plus className="size-4" strokeWidth={3} aria-hidden />
                            {dict.catalog.addToCart}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Notes + disclaimer */}
        {lineCount > 0 ? (
          <div className="private-shop-notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={dict.cart.notesPlaceholder}
              aria-label={dict.cart.notesPlaceholder}
              maxLength={2000}
            />
            <p>{t.vatNote}</p>
            <p>{t.disclaimer}</p>
          </div>
        ) : null}

        {/* Submit errors render in the sticky bar (next to the button) —
            when the cart is somehow empty, fall back to the in-page banner. */}
        {error && lineCount === 0 ? (
          <p
            role="alert"
            className="private-shop-error"
          >
            {t.error}
          </p>
        ) : null}
      </main>

      {/* Sticky order bar */}
      {lineCount > 0 ? (
        <div className="private-shop-order-bar">
          {/* Submit failure surfaces HERE, next to the button that caused it —
              the in-page banner above could sit far off-screen (M8A). */}
          {error ? (
            <div className="private-shop-order-message">
              <p
                role="alert"
                className="private-shop-error"
              >
                {t.error}
              </p>
            </div>
          ) : null}
          {prepFailed ? (
            <div className="private-shop-order-message">
              <p
                role="alert"
                className="private-shop-error"
              >
                {t.prepError}
              </p>
            </div>
          ) : null}
          {conflict ? (
            <div className="private-shop-order-message private-shop-conflict">
              <p
                role="alert"
                className="private-shop-warning"
              >
                {t.conflictError}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startNewAttempt}
                className="private-shop-new-attempt"
              >
                {t.conflictRetry}
              </Button>
            </div>
          ) : null}
          <div className="private-shop-order-inner">
            <div className="private-shop-order-summary">
              <p className="private-shop-line-count">
                <ShoppingCart className="size-3.5" aria-hidden />
                {dict.cart.title} · {formatNumber(lineCount, locale)}
              </p>
              <p className="private-shop-estimate" dir="ltr">
                {formatCurrency(estimate, locale)}
              </p>
            </div>
            <Button
              size="lg"
              onClick={onSubmit}
              disabled={pending || conflict}
              className="private-shop-submit"
            >
              <ShoppingCart className="size-5" aria-hidden />
              {pending ? t.submitting : t.submit}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
