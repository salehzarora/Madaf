"use client";

import {
  ArrowRight,
  CheckCircle2,
  PackageSearch,
  Plus,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
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
  const t = dict.access.showcase;
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"browse" | "checkout">("browse");
  const [pending, startTransition] = useTransition();
  const [publicRef, setPublicRef] = useState<string | null>(null);
  const [error, setError] = useState(false);

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
      filterAndSortProducts(catalog.products, filters, manufacturerById, locale),
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
    for (const [productId, qty] of cart) {
      const product = productById.get(productId);
      if (product) sum += qty * product.wholesalePrice;
    }
    return sum;
  }, [cart, productById]);

  const tenantName = catalog.tenantName[locale] || catalog.tenantName.he;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    const items = [...cart.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
    if (items.length === 0) return;
    const fd = new FormData(event.currentTarget);
    const city = ((fd.get("city") as string) || "").trim() || undefined;
    const cityKey =
      locale === "ar" ? "cityAr" : locale === "en" ? "cityEn" : "cityHe";
    startTransition(async () => {
      const result = await submitShowcaseOrderAction({
        token,
        items,
        store: {
          name: fd.get("name"),
          contactName: fd.get("contactName") || undefined,
          phone: fd.get("phone") || undefined,
          email: fd.get("email") || undefined,
          [cityKey]: city,
          address: fd.get("address") || undefined,
        },
        notes: notes.trim() || undefined,
      });
      if (result.ok && result.publicRef) {
        setPublicRef(result.publicRef);
        setCart(new Map());
        setNotes("");
      } else {
        setError(true);
      }
    });
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (publicRef) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <CheckCircle2 className="size-14 text-success" aria-hidden />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">
          {t.successTitle}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{t.successBody}</p>
        <div className="mt-5 rounded-card border border-line bg-surface-warm px-5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
            {t.orderNumberLabel}
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold text-ink" dir="ltr">
            {publicRef}
          </p>
        </div>
        <p className="mt-2 max-w-sm text-xs text-ink-soft">{t.refHint}</p>
        <p className="mt-6 max-w-sm text-xs text-ink-soft">{t.disclaimer}</p>
      </main>
    );
  }

  // ── Checkout (store details) ──────────────────────────────────────────────
  if (step === "checkout") {
    const su = dict.access.signup;
    return (
      <div className="min-h-dvh bg-surface-sunken">
        <header className="border-b border-line bg-surface-warm">
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-700">
              <Store className="size-5" aria-hidden />
            </span>
            <h1 className="min-w-0 truncate text-lg font-bold tracking-tight text-ink">
              {t.checkoutTitle}
            </h1>
            <div className="ms-auto">
              <LocaleSwitcher current={locale} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 py-6">
          <p className="rounded-field bg-info-soft px-4 py-3 text-sm text-info">
            {t.checkoutIntro}
          </p>

          {/* Order summary — read-only recap of the cart */}
          <div className="mt-5 rounded-card border border-line bg-surface">
            <div className="border-b border-line px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <ShoppingCart className="size-3.5" aria-hidden />
                {dict.cart.title} · {formatNumber(lineCount, locale)}
              </p>
            </div>
            <ul className="divide-y divide-line">
              {[...cart.entries()].map(([productId, qty]) => {
                const product = productById.get(productId);
                if (!product) return null;
                return (
                  <li
                    key={productId}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {productName(product, locale)}
                    </span>
                    <span
                      className="shrink-0 text-xs tabular-nums text-ink-muted"
                      dir="ltr"
                    >
                      ×{formatNumber(qty, locale)}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {formatCurrency(qty * product.wholesalePrice, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
              <span className="text-sm font-semibold text-ink">
                {t.estimatedTotal}
              </span>
              <span className="text-base font-extrabold tabular-nums text-ink">
                {formatCurrency(estimate, locale)}
              </span>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">{t.vatNote}</p>

          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
            <div>
              <Label htmlFor="sc-name">{su.storeName}</Label>
              <Input id="sc-name" name="name" required maxLength={200} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="sc-contact">
                  {su.contactName} · {dict.common.optional}
                </Label>
                <Input id="sc-contact" name="contactName" maxLength={200} />
              </div>
              <div>
                <Label htmlFor="sc-phone">
                  {su.phone} · {dict.common.optional}
                </Label>
                <Input id="sc-phone" name="phone" dir="ltr" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="sc-email">
                  {su.email} · {dict.common.optional}
                </Label>
                <Input
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
                <Input id="sc-city" name="city" maxLength={120} />
              </div>
            </div>
            <div>
              <Label htmlFor="sc-address">
                {su.address} · {dict.common.optional}
              </Label>
              <Input id="sc-address" name="address" maxLength={300} />
            </div>
            <div>
              <Label htmlFor="sc-notes">
                {dict.cart.orderNotes} · {dict.common.optional}
              </Label>
              <Textarea
                id="sc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={dict.cart.notesPlaceholder}
                maxLength={2000}
              />
            </div>

            <p className="text-xs text-ink-soft">{t.disclaimer}</p>

            {error ? (
              <p
                role="alert"
                className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
              >
                {t.error}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="submit" size="lg" disabled={pending} className="sm:flex-1">
                <ShoppingCart className="size-5" aria-hidden />
                {pending ? t.submitting : t.submit}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={pending}
                onClick={() => setStep("browse")}
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
    <div className="min-h-dvh bg-surface-sunken pb-24">
      <header className="border-b border-line bg-surface-warm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <Store className="size-3.5" aria-hidden />
              {t.browseOrder}
            </p>
            <h1 className="truncate text-lg font-bold tracking-tight text-ink">
              {tenantName}
            </h1>
          </div>
          <div className="ms-auto">
            <LocaleSwitcher current={locale} />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-6">
          <p className="text-sm text-ink-soft">{t.intro}</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        {catalog.products.length > 0 ? (
          <CatalogFilterBar
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
          <EmptyState icon={<PackageSearch />} title={t.empty} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<PackageSearch />}
            title={dict.catalog.noResults}
            hint={dict.catalog.noResultsHint}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                    "flex flex-col overflow-hidden rounded-card border bg-surface shadow-card transition-all",
                    qty > 0
                      ? "border-brand-500 ring-1 ring-brand-300"
                      : "border-line",
                  )}
                >
                  <ProductImage
                    product={product}
                    category={category}
                    className="aspect-[5/4] w-full sm:aspect-[4/3]"
                  />
                  <div className="flex flex-1 flex-col gap-0.5 px-3 pt-2.5">
                    <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-ink">
                      {productName(product, locale)}
                    </h3>
                    {manufacturer ? (
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-brand-700">
                        {manufacturer.name[locale]}
                      </p>
                    ) : null}
                    <p className="text-xs text-ink-muted">
                      {packageLabel(product, dict)}
                    </p>
                    <p className="mt-1.5 text-xl font-extrabold tracking-tight text-ink">
                      {formatCurrency(product.wholesalePrice, locale)}
                    </p>
                  </div>
                  <div className="px-3 pb-3 pt-2">
                    {qty > 0 ? (
                      <QuantityStepper
                        value={qty}
                        onChange={(next) => setQty(product.id, next)}
                        className="w-full justify-between border-brand-500 bg-brand-50"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQty(product.id, 1)}
                        disabled={soldOut}
                        className={cn(
                          "flex h-11 w-full items-center justify-center gap-1.5 rounded-field text-sm font-bold transition-all",
                          soldOut
                            ? "cursor-not-allowed bg-surface-sunken text-ink-muted"
                            : "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-[0.98]",
                        )}
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
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                <ShoppingCart className="size-3.5" aria-hidden />
                {dict.cart.title} · {formatNumber(lineCount, locale)}
              </p>
              <p className="text-lg font-extrabold tabular-nums text-ink">
                {formatCurrency(estimate, locale)}
              </p>
            </div>
            <Button size="lg" onClick={() => setStep("checkout")} className="ms-auto">
              {t.reviewOrder}
              <ArrowRight className="size-5 rtl:-scale-x-100" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
