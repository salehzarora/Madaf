"use client";

import { AlertTriangle, Boxes, PackagePlus } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { AdjustStockForm } from "@/components/admin/adjust-stock-form";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { isLowStock, productName } from "@/lib/catalog-helpers";
import { formatDate, formatNumber } from "@/lib/format";
import type { InventoryItem, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Days ahead treated as "expiring soon". */
const EXPIRY_HORIZON_DAYS = 21;
/** Demo "today" — aligned with the mock order timeline (mock-mode fallback). */
const DEMO_TODAY = "2026-07-05";

/** Inventory overview with low-stock filter and optional expiry column.
 * Rows AND products come from the server page (data layer) — products
 * include DEACTIVATED ones so tracked stock always renders (M8A crash fix;
 * the shared shop-data context stays active-only for the storefront).
 * M8B: owner/admin (supabase mode) get an inline manual-adjustment row. */
export function InventoryTable({
  inventory,
  products,
  today,
  canAdjust = false,
  initialLowOnly = false,
  locale,
  dict,
}: {
  inventory: InventoryItem[];
  products: Product[];
  /** Real current day (supabase mode); mock omits it → demo timeline. */
  today?: string;
  /** Owner/admin in supabase mode — shows the manual adjust action (M8B). */
  canAdjust?: boolean;
  /** Deep-link (?low=1) preselects the low-stock filter (M8D). */
  initialLowOnly?: boolean;
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.inventory;
  const [lowOnly, setLowOnly] = useState(initialLowOnly);
  const [adjusting, setAdjusting] = useState<string | null>(null);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const horizon =
    new Date(today ?? DEMO_TODAY).getTime() +
    EXPIRY_HORIZON_DAYS * 24 * 60 * 60 * 1000;

  const rows = useMemo(
    () =>
      inventory
        .flatMap((item) => {
          // Guarded: never crash on a row whose product is missing entirely.
          const product = productById.get(item.productId);
          if (!product) return [];
          const low = isLowStock(item);
          // Low-stock filter excludes DEACTIVATED products (M8D) so the list
          // matches the dashboard low-stock count that links here.
          if (lowOnly && (!low || product.isActive === false)) return [];
          return [
            {
              item,
              product,
              low,
              expiringSoon: item.nearestExpiry
                ? new Date(item.nearestExpiry).getTime() <= horizon
                : false,
            },
          ];
        }),
    [inventory, productById, lowOnly, horizon],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Chip
          selected={lowOnly}
          onClick={() => setLowOnly((v) => !v)}
          className="h-9 px-3 text-xs"
        >
          <AlertTriangle className="size-3.5" aria-hidden />
          {t.lowOnly}
        </Chip>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={lowOnly ? t.lowEmpty : dict.catalog.noResults}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-3 text-start">{t.colProduct}</th>
                <th className="px-4 py-3 text-end">{t.colStock}</th>
                <th className="px-4 py-3 text-start">{t.colLocation}</th>
                <th className="px-4 py-3 text-start">{t.colExpiry}</th>
                {canAdjust ? (
                  <th className="px-4 py-3 text-end">{dict.common.actions}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, product, low, expiringSoon }) => (
                <Fragment key={item.productId}>
                <tr
                  className={cn(
                    "border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm",
                    low && "bg-accent-wash",
                  )}
                >
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-ink">
                      {productName(product, locale)}
                    </p>
                    <p className="mt-0.5 font-mono text-[13px] text-ink-soft" dir="ltr">
                      {product.sku}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <span
                      className={cn(
                        "font-mono text-[13px] font-semibold tabular-nums",
                        item.stockPackages === 0
                          ? "text-danger"
                          : low
                            ? "text-warning"
                            : "text-ink",
                      )}
                      dir="ltr"
                    >
                      {formatNumber(item.stockPackages, locale)}
                    </span>
                    {low ? (
                      <Badge
                        tone={item.stockPackages === 0 ? "danger" : "warning"}
                        dot
                        className="ms-2"
                      >
                        {item.stockPackages === 0
                          ? dict.availability.outOfStock
                          : dict.availability.lowStock}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className="inline-flex items-center rounded-badge border border-line bg-surface-sunken px-2 py-0.5 font-mono text-xs text-ink-soft"
                      dir="ltr"
                    >
                      {item.location}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    {item.nearestExpiry ? (
                      expiringSoon ? (
                        <span className="inline-flex items-center gap-2 rounded-field border border-dashed border-warning/45 bg-accent-wash px-2 py-1">
                          <span
                            className="font-mono text-[13px] font-semibold tabular-nums text-warning"
                            dir="ltr"
                          >
                            {formatDate(item.nearestExpiry, locale)}
                          </span>
                          <Badge tone="warning" dashed dot>
                            {t.expiringSoon}
                          </Badge>
                        </span>
                      ) : (
                        <span
                          className="font-mono text-[13px] tabular-nums text-ink-soft"
                          dir="ltr"
                        >
                          {formatDate(item.nearestExpiry, locale)}
                        </span>
                      )
                    ) : (
                      <span className="text-ink-muted">{t.noExpiry}</span>
                    )}
                  </td>
                  {canAdjust ? (
                    <td className="px-4 py-3.5 text-end">
                      <button
                        type="button"
                        onClick={() =>
                          setAdjusting((prev) =>
                            prev === item.productId ? null : item.productId,
                          )
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-3 text-xs font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        <PackagePlus className="size-3.5" aria-hidden />
                        {t.adjust.button}
                      </button>
                    </td>
                  ) : null}
                </tr>
                {canAdjust && adjusting === item.productId ? (
                  <tr className="border-b border-line-hair last:border-0">
                    <td colSpan={5} className="px-4 py-3">
                      <AdjustStockForm
                        productId={item.productId}
                        currentQuantity={item.stockPackages}
                        locale={locale}
                        dict={dict}
                        onClose={() => setAdjusting(null)}
                      />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
