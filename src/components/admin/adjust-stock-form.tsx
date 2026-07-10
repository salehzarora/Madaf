"use client";

import { CheckCircle2, PackagePlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { adjustStockAction } from "@/lib/actions/inventory";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const REASONS = [
  "manual_stock_count",
  "manual_damaged_goods",
  "manual_returned_goods",
  "manual_supplier_delivery",
  "manual_correction",
  "manual_other",
] as const;

/**
 * Inline manual stock adjustment (M8B.2) — owner/admin only (the page hides
 * it otherwise; adjust_inventory_stock re-enforces in Postgres). Signed
 * delta + required reason + optional note; live preview of the resulting
 * quantity; negative results are pre-blocked here AND in the RPC.
 */
export function AdjustStockForm({
  productId,
  currentQuantity,
  locale,
  dict,
  onClose,
}: {
  productId: string;
  currentQuantity: number;
  locale: Locale;
  dict: Dictionary;
  onClose: () => void;
}) {
  const t = dict.admin.inventory.adjust;
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<
    "negative" | "reasonRequired" | "deltaRequired" | "failed" | null
  >(null);
  const [savedQty, setSavedQty] = useState<number | null>(null);

  // Number() (not parseInt) so "5.5" is REJECTED instead of silently
  // truncated to 5, and "1e3" is honored as 1000 — the committed delta is
  // always exactly the number the input holds.
  const parsed = delta.trim() === "" ? Number.NaN : Number(delta);
  const validDelta = Number.isInteger(parsed) && parsed !== 0;
  const preview = validDelta ? currentQuantity + parsed : null;

  function onSave() {
    if (!validDelta) {
      setErrorKey("deltaRequired");
      return;
    }
    if (!reason) {
      setErrorKey("reasonRequired");
      return;
    }
    if (preview !== null && preview < 0) {
      setErrorKey("negative");
      return;
    }
    setErrorKey(null);
    startTransition(async () => {
      const result = await adjustStockAction({
        productId,
        delta: parsed,
        reason,
        note: note.trim() || undefined,
        locale,
      });
      if (result.ok && typeof result.newQuantity === "number") {
        setSavedQty(result.newQuantity);
        return;
      }
      setErrorKey(result.reason === "negative" ? "negative" : "failed");
    });
  }

  if (savedQty !== null) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-field bg-success-soft px-4 py-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {t.success}
        </p>
        <span className="font-mono text-sm font-bold tabular-nums text-ink" dir="ltr">
          {formatNumber(savedQty, locale)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="ms-auto"
        >
          {dict.common.close}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-field border border-line bg-surface-warm p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
        <PackagePlus className="size-4 text-brand-600" aria-hidden />
        {t.title}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`adj-delta-${productId}`}>{t.deltaLabel}</Label>
          <Input
            id={`adj-delta-${productId}`}
            type="number"
            inputMode="numeric"
            step={1}
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder={t.deltaPlaceholder}
            mono
            dir="ltr"
          />
        </div>
        <div>
          <Label htmlFor={`adj-reason-${productId}`}>{t.reasonLabel}</Label>
          <Select
            id={`adj-reason-${productId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t.reasonPlaceholder}</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {dict.admin.inventory.movements.reasons[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-3 pb-1 text-sm">
          <span className="text-ink-muted">
            {t.currentLabel}:{" "}
            <span className="font-mono font-semibold tabular-nums text-ink" dir="ltr">
              {formatNumber(currentQuantity, locale)}
            </span>
          </span>
          {preview !== null ? (
            <span className="text-ink-muted">
              {t.newLabel}:{" "}
              <span
                className={cn(
                  "font-mono font-semibold tabular-nums",
                  preview < 0 ? "text-danger" : "text-brand-700",
                )}
                dir="ltr"
              >
                {formatNumber(preview, locale)}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div>
        <Label htmlFor={`adj-note-${productId}`}>
          {t.noteLabel} · {dict.common.optional}
        </Label>
        <Textarea
          id={`adj-note-${productId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </div>

      {errorKey ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {t.errors[errorKey]}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onSave} disabled={pending}>
          {pending ? t.saving : t.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onClose}
        >
          {dict.common.cancel}
        </Button>
      </div>
    </div>
  );
}
