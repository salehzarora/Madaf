"use client";
import { getDataMode } from "@/lib/data/mode";
import { useOrderQuote } from "@/lib/use-order-quote";
import { useEffectivePrices } from "@/lib/use-effective-prices";

import {
  ArrowRight,
  CheckCircle2,
  PackageSearch,
  Plus,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { CatalogFilterBar } from "@/components/shop/catalog-filter-bar";
import { EmptyState } from "@/components/empty-state";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import {
  emptyCatalogFilters,
  filterAndSortProducts,
} from "@/lib/catalog-filter";
import type { ShowcaseCatalog } from "@/lib/data/catalog-showcase";
import { submitShowcaseOrderAction } from "@/lib/actions/catalog-showcase";
import {
  clearTokenSubmissionKey,
  getOrCreateTokenSubmissionKey,
  rotateTokenSubmissionKey,
} from "@/lib/client/order-submission-key";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

const FALLBACK_CATEGORY: Category = {
  id: "misc",
  name: { ar: "", he: "", en: "" },
  icon: "📦",
  hue: 0,
};

/**
 * Showcase / guest ordering (M7H.3 → M7I.1). A prospective store opens the
 * supplier's tokenized "browse products" link with NO login, browses the
 * catalog, builds a local cart, and submits an ORDER REQUEST with its store
 * details. There is no customer account — the store snapshot is captured
 * server-side and the visitor only ever sees a public request number. The
 * token is validated by SECURITY DEFINER RPCs (never trusted client-side).
 */
export function ShowcaseView({
  locale,
  dict,
  token,
  catalog,
}: {
  locale: Locale;
  dict: Dictionary;
  token: string;
  catalog: ShowcaseCatalog;
}) {
  const requiresQuote = getDataMode() !== "mock";
  const t = dict.access.showcase;
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"browse" | "checkout">("browse");
  const [pending, startTransition] = useTransition();
  const [publicRef, setPublicRef] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);
  // FIX2: browser storage unavailable → could not prepare a persistent submission
  // key; fail closed rather than submit with a volatile key.
  const [prepFailed, setPrepFailed] = useState(false);
  const pricing = useEffectivePrices(catalog.products, { token, showcase: true });
  const review = useOrderQuote({ token, showcase: true }, [...cart].map(([productId, quantity]) => ({ productId, quantity })), pricing.key, pricing.ready);
  const [priceChanged, setPriceChanged] = useState(false);
  const [attempt, setAttempt] = useState<Parameters<typeof submitShowcaseOrderAction>[0] | null>(null);
  const busy = useRef(false);
  const reviewedKey = useRef<string | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  function priceText(id: string, quantity = 1, divisor = 1) {
    const quoted = review.quote?.lines.find(i => i.product_id === id);
    const price = quoted ? Number(quoted.unit_price_snapshot) : pricing.priceOf(id);
    return price === null ? "—" : formatCurrency(price * quantity / divisor, locale);
  }

  const categoryById = useMemo(
    () => new Map(catalog.categories.map((c) => [c.id, c])),
    [catalog.categories],
  );
  const manufacturerById = useMemo(
    () => new Map(catalog.manufacturers.map((m) => [m.id, m])),
    [catalog.manufacturers],
  );
  const productById = useMemo(
    () => new Map(catalog.products.map((p) => [p.id, p])),
    [catalog.products],
  );
  const visible = useMemo(
    () =>
      filterAndSortProducts(catalog.products, filters, manufacturerById, locale, pricing),
    [catalog.products, filters, manufacturerById, locale, pricing],
  );

  function setQty(productId: string, qty: number) {
    if (pending || attempt) return;
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  const lineCount = cart.size;
  const estimate = review.quote ? Number(review.quote.headers.subtotal) : requiresQuote ? null : [...cart].reduce((sum, [id, qty]) => sum + qty * (pricing.priceOf(id) ?? 0), 0);

  const tenantName = catalog.tenantName[locale] || catalog.tenantName.he;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unresolved || busy.current || (!attempt && requiresQuote && !review.quote)) return;
    busy.current = true;
    setError(false);
    setConflict(false);
    setPrepFailed(false);
    const items = [...cart.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
    if (items.length === 0 && !attempt) { busy.current = false; return; }
    const fd = new FormData(event.currentTarget);
    const city = ((fd.get("city") as string) || "").trim() || undefined;
    const cityKey =
      locale === "ar" ? "cityAr" : locale === "en" ? "cityEn" : "cityHe";
    const store = {
      name: fd.get("name"),
      contactName: fd.get("contactName") || undefined,
      phone: fd.get("phone") || undefined,
      email: fd.get("email") || undefined,
      [cityKey]: city,
      address: fd.get("address") || undefined,
    };
    startTransition(async () => {
      // FIX2: one submission key per logical order, PERSISTED in sessionStorage
      // (scoped to this showcase token) so a refresh/remount retry reuses it.
      // Fail closed if storage is unavailable.
      const keyResult = attempt ? { ok: true as const, key: attempt.submissionKey, existing: true } : await getOrCreateTokenSubmissionKey("showcase", token);
      if (!keyResult.ok) {
        setPrepFailed(true);
        busy.current = false;
        return;
      }
      if (requiresQuote && keyResult.existing && !attempt && reviewedKey.current !== keyResult.key) {
        setUnresolved(true); busy.current = false; return;
      }
      reviewedKey.current = keyResult.key;
      try {
        const payload = attempt ?? {
          token,
          items,
          store,
          notes: notes.trim() || undefined,
          submissionKey: keyResult.key,
          ...(review.quote ? { quote: review.quote.quote } : {}),
        };
        setAttempt(payload);
        const result = await submitShowcaseOrderAction({ ...payload, ...(attempt && requiresQuote ? { quote: { mode: "replay_only" } as const } : {}) });
        if (result.ok && result.publicRef) {
          setAttempt(null);
          setPublicRef(result.publicRef);
          setCart(new Map());
          setNotes("");
          await clearTokenSubmissionKey("showcase", token); // next order = new key
        } else if (result.reason === "pricing") {
          setAttempt(null); setPriceChanged(true); pricing.retry(); review.refresh();
        } else if (result.reason === "conflict") {
          setConflict(true); // key reused with a changed order; keep the cart + form
        } else {
          setError(true); // keep the key — a retry reuses it
        }
      } catch {
        // Ambiguous transport/server-action failure: KEEP the persisted key so the
        // retry is the same logical order.
        setError(true);
      } finally { busy.current = false; }
    });
  }

  // Explicit new attempt after a conflict: rotate the persisted key, keep the form.
  async function startNewAttempt() {
    const rotated = await rotateTokenSubmissionKey("showcase", token);
    if (!rotated.ok) { setPrepFailed(true); return; }
    reviewedKey.current = rotated.key;
    setAttempt(null);
    setConflict(false);
    setError(false);
    setPrepFailed(false);
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (publicRef) {
    return (
      <main className="storefront-theme showcase-store public-store-terminal showcase-success">
        <div className="public-store-terminal-panel">
          <CheckCircle2 className="public-store-success-icon" aria-hidden />
          <h1>{t.successTitle}</h1>
          <p className="public-store-terminal-body">{t.successBody}</p>
          <div className="public-store-reference">
            <p>{t.orderNumberLabel}</p>
            <p className="public-store-reference-value" dir="ltr">
              {publicRef}
            </p>
          </div>
          <p className="public-store-terminal-hint">{t.refHint}</p>
          <p className="public-store-disclaimer">{t.disclaimer}</p>
        </div>
      </main>
    );
  }

  // ── Checkout (store details) ──────────────────────────────────────────────
  if (step === "checkout") {
    const su = dict.access.signup;
    return (
      <div className="storefront-theme showcase-store showcase-checkout">
        <header className="public-store-header">
          <div className="public-store-header-inner">
            <span className="showcase-checkout-icon">
              <Store className="size-5" aria-hidden />
            </span>
            <h1 className="showcase-checkout-title">
              {t.checkoutTitle}
            </h1>
            <div className="public-store-locale">
              <LocaleSwitcher current={locale} label={dict.common.language} variant="compact" />
            </div>
          </div>
        </header>

        <main className="showcase-checkout-main">
          <p className="showcase-checkout-intro">
            {t.checkoutIntro}
          </p>

          {/* Order summary — read-only recap of the cart */}
          <div className="showcase-summary">
            <div className="showcase-summary-header">
              <p>
                <ShoppingCart className="size-3.5" aria-hidden />
                {dict.cart.title} · {formatNumber(lineCount, locale)}
              </p>
            </div>
            <ul>
              {[...cart.entries()].map(([productId, qty]) => {
                const product = productById.get(productId);
                if (!product) return null;
                return (
                  <li
                    key={productId}
                    className="showcase-summary-line"
                  >
                    <span className="showcase-summary-name">
                      {productName(product, locale)}
                    </span>
                    <span
                      className="showcase-summary-quantity"
                      dir="ltr"
                    >
                      ×{formatNumber(qty, locale)}
                    </span>
                    <span className="showcase-summary-price" dir="ltr">
                      {priceText(product.id, qty)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="showcase-summary-total">
              <span>
                {t.estimatedTotal}
              </span>
              <span dir="ltr">
                {estimate === null ? "—" : formatCurrency(estimate, locale)}
              </span>
            </div>
          </div>
          <p className="showcase-vat-note">{t.vatNote}</p>

          <form onSubmit={onSubmit} className="showcase-guest-form">
            <div>
              <Label htmlFor="sc-name">{su.storeName}</Label>
              <Input readOnly={pending || !!attempt} id="sc-name" name="name" required maxLength={200} />
            </div>
            <div className="showcase-field-grid">
              <div>
                <Label htmlFor="sc-contact">
                  {su.contactName} · {dict.common.optional}
                </Label>
                <Input readOnly={pending || !!attempt} id="sc-contact" name="contactName" maxLength={200} />
              </div>
              <div>
                <Label htmlFor="sc-phone">
                  {su.phone} · {dict.common.optional}
                </Label>
                <Input readOnly={pending || !!attempt} id="sc-phone" name="phone" dir="ltr" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="sc-email">
                  {su.email} · {dict.common.optional}
                </Label>
                <Input readOnly={pending || !!attempt}
                  id="sc-email"
                  name="email"
                  type="email"
                  dir="ltr"
                  maxLength={254}
                />
              </div>
              <div>
                <Label htmlFor="sc-city">
                  {su.city} · {dict.common.optional}
                </Label>
                <Input readOnly={pending || !!attempt} id="sc-city" name="city" maxLength={120} />
              </div>
            </div>
            <div>
              <Label htmlFor="sc-address">
                {su.address} · {dict.common.optional}
              </Label>
              <Input readOnly={pending || !!attempt} id="sc-address" name="address" maxLength={300} />
            </div>
            <div>
              <Label htmlFor="sc-notes">
                {dict.cart.orderNotes} · {dict.common.optional}
              </Label>
              <Textarea disabled={pending || !!attempt}
                id="sc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={dict.cart.notesPlaceholder}
                maxLength={2000}
              />
            </div>

            <p className="showcase-form-disclaimer">{t.disclaimer}</p>

            {error ? (
              <p
                role="alert"
                className="public-store-error"
              >
                {t.error}
              </p>
            ) : null}
            {prepFailed ? (
              <p
                role="alert"
                className="public-store-error"
              >
                {t.prepError}
              </p>
            ) : null}
            {conflict ? (
              <div
                role="alert"
                className="public-store-warning showcase-conflict"
              >
                <span>{t.conflictError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={startNewAttempt}
                  className="public-store-new-attempt"
                >
                  {t.conflictRetry}
                </Button>
              </div>
            ) : null}

            <div className="showcase-form-actions">
              {priceChanged ? <p role="status">{dict.pricing.changed}</p> : null}
              {unresolved ? <p role="alert">{dict.pricing.unresolved}</p> : null}
              {attempt && !pending ? <p role="status">{dict.pricing.pending}</p> : null}
              {!attempt && requiresQuote && !review.quote ? <p role="status">{dict.pricing.unavailable} <button type="button" onClick={review.refresh}>{dict.pricing.retry}</button></p> : null}
              <Button
                type="submit"
                size="lg"
                disabled={unresolved || pending || conflict || (!attempt && requiresQuote && !review.quote)}
                className="showcase-submit"
              >
                <ShoppingCart className="size-5" aria-hidden />
                {pending ? t.submitting : t.submit}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={pending || !!attempt}
                onClick={() => setStep("browse")}
                className="showcase-back"
              >
                {t.backToProducts}
              </Button>
            </div>
          </form>
        </main>
      </div>
    );
  }

  // ── Browse ────────────────────────────────────────────────────────────────
  return (
    <div className="storefront-theme showcase-store">
      <header className="public-store-header">
        <div className="public-store-header-inner">
          {catalog.tenantLogoUrl ? (
            // Supplier business logo (M8E.1) — signed URL; graceful fallback.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalog.tenantLogoUrl}
              alt=""
              className="public-store-supplier-logo"
            />
          ) : null}
          <div className="public-store-supplier">
            <p className="showcase-browse-label">
              <Store className="size-3.5" aria-hidden />
              {t.browseOrder}
            </p>
            <h1>
              {tenantName}
            </h1>
          </div>
          <div className="public-store-locale">
            <LocaleSwitcher current={locale} label={dict.common.language} variant="compact" />
          </div>
        </div>
        <div className="showcase-intro-wrap">
          <p>{t.intro}</p>
        </div>
      </header>

      <main className="public-store-main">
        {catalog.products.length > 0 ? (
          <CatalogFilterBar
            className="public-store-filter-bar"
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
          <EmptyState className="public-store-empty" icon={<PackageSearch />} title={t.empty} />
        ) : visible.length === 0 ? (
          <EmptyState
            className="public-store-empty"
            icon={<PackageSearch />}
            title={dict.catalog.noResults}
            hint={dict.catalog.noResultsHint}
          />
        ) : (
          <div className="public-store-grid">
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
                    "public-store-product",
                    qty > 0 && "public-store-product-selected",
                  )}
                >
                  <ProductImage
                    product={product}
                    category={category}
                    presentation="storefront"
                    className="public-store-product-media"
                  />
                  <div className="public-store-product-copy">
                    <h3>
                      {productName(product, locale)}
                    </h3>
                    {manufacturer ? (
                      <p className="public-store-product-brand">
                        {manufacturer.name[locale]}
                      </p>
                    ) : null}
                    <p className="public-store-product-package">
                      {packageLabel(product, dict)}
                    </p>
                    <p className="public-store-product-price" dir="ltr">
                      {priceText(product.id)}
                    </p>
                  </div>
                  <div className="public-store-product-action">
                    {soldOut && qty > 0 ? (
                      <p className="public-store-sold-out">{dict.availability.outOfStock}</p>
                    ) : null}
                    {qty > 0 ? (
                      <QuantityStepper
                        value={qty}
                        increaseDisabled={soldOut}
                        onChange={(next) => setQty(product.id, next)}
                        className="public-store-quantity"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQty(product.id, 1)}
                        disabled={soldOut}
                        className="public-store-add"
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
      </main>

      {/* Sticky order bar — proceed to store details */}
      {lineCount > 0 ? (
        <div className="public-store-order-bar">
          <div className="public-store-order-inner">
            <div className="public-store-order-summary">
              <p className="public-store-line-count">
                <ShoppingCart className="size-3.5" aria-hidden />
                {dict.cart.title} · {formatNumber(lineCount, locale)}
              </p>
              <p className="public-store-estimate" dir="ltr">
                {estimate === null ? "—" : formatCurrency(estimate, locale)}
              </p>
            </div>
            <Button size="lg" onClick={() => setStep("checkout")} className="public-store-submit showcase-proceed">
              {t.reviewOrder}
              <ArrowRight className="size-5 rtl:-scale-x-100" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
