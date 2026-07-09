"use client";

import { CheckCircle2, Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { ProductImage } from "@/components/product-image";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { updateOrderItemsAction } from "@/lib/actions/orders";
import { packageLabel, productName } from "@/lib/catalog-helpers";
import { formatCurrency } from "@/lib/format";
import type { Category, Order, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_QTY = 999;

/**
 * Owner/admin order editing (M7I.3). Add/remove lines, change quantities, and
 * update notes. All pricing/validation happens in `update_order_items` (the RPC
 * re-snapshots lines from live products and reconciles reserved inventory) —
 * this UI only builds the desired line set. Delivered/cancelled orders are
 * locked. Supabase mode only (mock has no write path).
 */
export function OrderItemsEditor({
  order,
  products,
  categories,
  locale,
  live,
  dict,
}: {
  order: Order;
  products: Product[];
  categories: Category[];
  locale: Locale;
  live: boolean;
  dict: Dictionary;
}) {
  const t = dict.admin.orders.detail.edit;
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const locked = order.status === "delivered" || order.status === "cancelled";
  const reserved = order.status === "confirmed" || order.status === "preparing";

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState(order.notes ?? "");
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<
    "error" | "insufficientStock" | "empty" | null
  >(null);
  const [done, setDone] = useState(false);

  function begin() {
    setLines(new Map(order.items.map((i) => [i.productId, i.quantity])));
    setNotes(order.notes ?? "");
    setSearch("");
    setErrorKey(null);
    setDone(false);
    setEditing(true);
  }

  function setQty(productId: string, qty: number) {
    setLines((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  const addable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.isActive !== false && !lines.has(p.id))
      .filter((p) =>
        q
          ? [
              productName(p, locale),
              p.sku,
              p.translations.ar.name,
              p.translations.he.name,
              p.translations.en.name,
            ]
              .join(" ")
              .toLowerCase()
              .includes(q)
          : true,
      )
      .slice(0, 8);
  }, [products, lines, search, locale]);

  const estimate = useMemo(() => {
    let sum = 0;
    for (const [productId, qty] of lines) {
      const p = productById.get(productId);
      if (p) sum += qty * p.wholesalePrice;
    }
    return sum;
  }, [lines, productById]);

  function onSave() {
    const items = [...lines.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
    if (items.length === 0) {
      setErrorKey("empty");
      return;
    }
    setErrorKey(null);
    startTransition(async () => {
      // Always send the (trimmed) string — an EMPTY value must reach the RPC
      // so clearing notes actually clears them (undefined = keep old; M8A).
      const result = await updateOrderItemsAction({
        orderId: order.id,
        items,
        notes: notes.trim(),
        locale,
      });
      if (result.ok) {
        setDone(true);
        setEditing(false);
        return;
      }
      if (result.reason === "insufficient_stock") setErrorKey("insufficientStock");
      else if (result.reason === "locked") setErrorKey("error");
      else setErrorKey("error");
    });
  }

  // Mock mode has no edit write path — hide the editor entirely.
  if (!live) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t.title}</CardTitle>
          {!editing && !locked ? (
            <Button type="button" variant="ghost" size="sm" onClick={begin}>
              <Pencil className="size-4" aria-hidden />
              {t.button}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {locked ? (
          <p className="text-sm text-ink-muted">{t.lockedHint}</p>
        ) : !editing ? (
          <div className="flex flex-col gap-2">
            {done ? (
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                {t.success}
              </p>
            ) : (
              <p className="text-sm text-ink-soft">
                {reserved ? t.reservedHint : t.button}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {reserved ? (
              <p className="rounded-field bg-info-soft px-3 py-2 text-xs text-info">
                {t.reservedHint}
              </p>
            ) : null}

            {/* Current lines */}
            <ul className="flex flex-col divide-y divide-line-hair">
              {[...lines.entries()].map(([productId, qty]) => {
                const product = productById.get(productId);
                const category = product
                  ? categoryById.get(product.categoryId)
                  : undefined;
                return (
                  <li key={productId} className="flex items-center gap-3 py-2.5">
                    {product ? (
                      <ProductImage
                        product={product}
                        category={category}
                        className="size-10 shrink-0 rounded-field"
                        iconClassName="size-4"
                        showSizeTag={false}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {product ? productName(product, locale) : productId}
                      </p>
                      {product ? (
                        <p className="text-xs text-ink-muted">
                          {formatCurrency(product.wholesalePrice, locale)} ·{" "}
                          {packageLabel(product, dict)}
                        </p>
                      ) : null}
                    </div>
                    <QuantityStepper
                      value={qty}
                      min={1}
                      max={MAX_QTY}
                      size="sm"
                      onChange={(next) => setQty(productId, next)}
                    />
                    <button
                      type="button"
                      aria-label={t.remove}
                      onClick={() => setQty(productId, 0)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-field text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Add product */}
            <div className="rounded-field border border-line bg-surface-warm p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-ink-muted">
                {t.addProduct}
              </p>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-muted"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchProduct}
                  aria-label={t.searchProduct}
                  className="ps-9"
                />
              </div>
              <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {addable.length === 0 ? (
                  <li className="px-1 py-2 text-xs text-ink-muted">{t.noneToAdd}</li>
                ) : (
                  addable.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setQty(product.id, 1);
                          setSearch("");
                        }}
                        className="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start transition-colors hover:bg-surface-sunken"
                      >
                        <Plus
                          className="size-4 shrink-0 text-brand-600"
                          strokeWidth={3}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {productName(product, locale)}
                        </span>
                        <span className="shrink-0 text-xs text-ink-muted">
                          {formatCurrency(product.wholesalePrice, locale)}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {/* Notes */}
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={dict.cart.notesPlaceholder}
              maxLength={2000}
            />

            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-ink">
                {dict.common.subtotal}
              </span>
              <span className="font-bold tabular-nums text-ink">
                {formatCurrency(estimate, locale)}
              </span>
            </div>

            {errorKey ? (
              <p
                role="alert"
                className={cn(
                  "rounded-field px-3 py-2 text-sm font-medium",
                  errorKey === "insufficientStock"
                    ? "bg-warning-soft text-warning"
                    : "bg-danger-soft text-danger",
                )}
              >
                {t[errorKey]}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={pending}
                className="sm:flex-1"
              >
                {pending ? t.saving : t.save}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                {t.cancel}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
