"use client";

import { AlertTriangle, Boxes } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { isLowStock, productName } from "@/lib/catalog-helpers";
import { formatDate, formatNumber } from "@/lib/format";
import { useShopData } from "@/lib/shop-data-context";
import type { InventoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Days ahead treated as "expiring soon" in the demo. */
const EXPIRY_HORIZON_DAYS = 21;
/** Demo "today" — aligned with the mock order timeline. */
const DEMO_TODAY = "2026-07-05";

/** Inventory overview with low-stock filter and optional expiry column.
 * Rows come from the server page (data layer). */
export function InventoryTable({
  inventory,
  locale,
  dict,
}: {
  inventory: InventoryItem[];
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.inventory;
  const { productById } = useShopData();
  const [lowOnly, setLowOnly] = useState(false);

  const horizon =
    new Date(DEMO_TODAY).getTime() + EXPIRY_HORIZON_DAYS * 24 * 60 * 60 * 1000;

  const rows = useMemo(
    () =>
      inventory
        .filter((item) => (lowOnly ? isLowStock(item) : true))
        .map((item) => ({
          item,
          product: productById.get(item.productId)!,
          low: isLowStock(item),
          expiringSoon: item.nearestExpiry
            ? new Date(item.nearestExpiry).getTime() <= horizon
            : false,
        })),
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
        <EmptyState icon={<Boxes />} title={dict.catalog.noResults} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 text-start font-medium">{t.colProduct}</th>
                <th className="px-4 py-3 text-end font-medium">{t.colStock}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colLocation}</th>
                <th className="px-4 py-3 text-start font-medium">{t.colExpiry}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, product, low, expiringSoon }) => (
                <tr
                  key={item.productId}
                  className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-sunken/50"
                >
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-ink">
                      {productName(product, locale)}
                    </p>
                    <p className="text-xs text-ink-muted" dir="ltr">
                      {product.sku}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        item.stockPackages === 0
                          ? "text-danger"
                          : low
                            ? "text-warning"
                            : "text-ink",
                      )}
                    >
                      {formatNumber(item.stockPackages, locale)}
                    </span>
                    {low ? (
                      <Badge
                        tone={item.stockPackages === 0 ? "danger" : "warning"}
                        className="ms-2"
                      >
                        {item.stockPackages === 0
                          ? dict.availability.outOfStock
                          : dict.availability.lowStock}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5 text-ink-soft" dir="ltr">
                    {item.location}
                  </td>
                  <td className="px-4 py-3.5">
                    {item.nearestExpiry ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            "tabular-nums",
                            expiringSoon ? "font-semibold text-warning" : "text-ink-soft",
                          )}
                        >
                          {formatDate(item.nearestExpiry, locale)}
                        </span>
                        {expiringSoon ? (
                          <Badge tone="warning">{t.expiringSoon}</Badge>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-muted">{t.noExpiry}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
