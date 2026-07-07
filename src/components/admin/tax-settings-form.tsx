"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { localeNames, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { saveTaxSettingsAction } from "@/lib/actions/tax";
import type { LegalInvoicingStatus } from "@/lib/config/legal-invoicing";
import type { TenantTaxSettings } from "@/lib/data/tax-settings";
import { cn } from "@/lib/utils";

/**
 * Tenant tax-settings form (M6B).
 *
 * ⚠️ INERT by design. This form has a PERMANENT, unremovable warning that
 * legal invoicing is not active and that saving issues nothing. It contains
 * NO issue-invoice, allocation-number, provider-connection, payment, or
 * legal-download controls — only a Save button that persists configuration.
 */
export function TaxSettingsForm({
  locale,
  dict,
  initial,
  status,
  live,
}: {
  locale: Locale;
  dict: Dictionary;
  initial: TenantTaxSettings | null;
  status: LegalInvoicingStatus;
  live: boolean;
}) {
  const t = dict.admin.settings;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const vatPercent =
    initial?.defaultVatRate != null
      ? Number((initial.defaultVatRate * 100).toFixed(2))
      : undefined;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveFailed(false);
    setSaved(false);

    // Mock/demo: nothing is stored (and there is no legal issuing anywhere).
    if (!live) {
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const fd = new FormData(event.currentTarget);
    const num = (v: FormDataEntryValue | null): number | null => {
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    const text = (v: FormDataEntryValue | null): string | null => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || null;
    };

    setSaving(true);
    try {
      const result = await saveTaxSettingsAction({
        legalName: text(fd.get("legalName")),
        businessRegistrationNumber: text(fd.get("businessRegistrationNumber")),
        vatRegistrationNumber: text(fd.get("vatRegistrationNumber")),
        vatRegistrationType: text(fd.get("vatRegistrationType")),
        countryCode: text(fd.get("countryCode")),
        defaultVatRatePercent: num(fd.get("defaultVatRatePercent")),
        invoiceLanguage: text(fd.get("invoiceLanguage")),
        street: text(fd.get("street")),
        city: text(fd.get("city")),
        postalCode: text(fd.get("postalCode")),
        country: text(fd.get("country")),
        contactEmail: text(fd.get("contactEmail")),
        contactPhone: text(fd.get("contactPhone")),
        legalInvoicingReady: fd.get("legalInvoicingReady") === "on",
        readinessNotes: text(fd.get("readinessNotes")),
        locale,
      });
      if (result.ok) {
        setSaved(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        setSaving(false);
        return;
      }
    } catch {
      // fall through to the error banner
    }
    setSaving(false);
    setSaveFailed(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* PERMANENT legal warning — never remove. Nothing here issues a tax
          invoice; saving only stores configuration. */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-card border border-warning/50 bg-accent-wash px-4 py-3.5 text-accent-deep"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-[13px] font-semibold leading-relaxed">
          {t.notActiveWarning}
        </p>
      </div>

      {/* Read-only feature-flag status (server-side switches; all OFF). */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.flagsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <p className="text-[13px] text-ink-soft">{t.flagsSubtitle}</p>
          <dl className="flex flex-col divide-y divide-line-hair">
            <FlagRow label={t.flagInvoicing}>
              <Badge tone="neutral" dot>
                {t.statusOff}
              </Badge>
            </FlagRow>
            <FlagRow label={t.flagProvider}>
              <Badge tone="neutral" dot>
                {status.providerMode === "disabled"
                  ? t.statusDisabled
                  : status.providerMode}
              </Badge>
            </FlagRow>
            <FlagRow label={t.flagNumbering}>
              <Badge tone="neutral" dot>
                {t.statusOff}
              </Badge>
            </FlagRow>
          </dl>
        </CardContent>
      </Card>

      {/* Mode notice + saved / error banners. */}
      <p
        className={cn(
          "rounded-field px-4 py-3 text-sm",
          live ? "bg-success-soft text-success" : "bg-info-soft text-info",
        )}
      >
        {live ? t.liveNotice : t.mockNotice}
      </p>

      {saved ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-field bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {t.savedToast}
        </div>
      ) : null}

      {/* Legal identity */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionIdentity}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ts-legal-name">{t.legalName}</Label>
            <Input
              id="ts-legal-name"
              name="legalName"
              maxLength={200}
              defaultValue={initial?.legalName ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-business-reg">
              {t.businessRegistrationNumber}
            </Label>
            <Input
              id="ts-business-reg"
              name="businessRegistrationNumber"
              mono
              dir="ltr"
              maxLength={40}
              defaultValue={initial?.businessRegistrationNumber ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-vat-reg">{t.vatRegistrationNumber}</Label>
            <Input
              id="ts-vat-reg"
              name="vatRegistrationNumber"
              mono
              dir="ltr"
              maxLength={40}
              defaultValue={initial?.vatRegistrationNumber ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-vat-type">{t.vatRegistrationType}</Label>
            <Input
              id="ts-vat-type"
              name="vatRegistrationType"
              maxLength={60}
              defaultValue={initial?.vatRegistrationType ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-country-code">{t.countryCode}</Label>
            <Input
              id="ts-country-code"
              name="countryCode"
              mono
              dir="ltr"
              maxLength={3}
              defaultValue={initial?.countryCode ?? "IL"}
            />
          </div>
          <div>
            <Label htmlFor="ts-vat-rate">{t.defaultVatRate}</Label>
            <Input
              id="ts-vat-rate"
              name="defaultVatRatePercent"
              type="number"
              min={0}
              max={99.9999}
              step="0.01"
              dir="ltr"
              className="tabular-nums"
              defaultValue={vatPercent ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-invoice-lang">{t.invoiceLanguage}</Label>
            <Select
              id="ts-invoice-lang"
              name="invoiceLanguage"
              defaultValue={initial?.invoiceLanguage ?? ""}
            >
              <option value="">{t.invoiceLanguageAuto}</option>
              <option value="he">{localeNames.he}</option>
              <option value="ar">{localeNames.ar}</option>
              <option value="en">{localeNames.en}</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Registered address */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionAddress}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ts-street">{t.street}</Label>
            <Input
              id="ts-street"
              name="street"
              maxLength={200}
              defaultValue={initial?.street ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-city">{t.city}</Label>
            <Input
              id="ts-city"
              name="city"
              maxLength={120}
              defaultValue={initial?.city ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-postal">{t.postalCode}</Label>
            <Input
              id="ts-postal"
              name="postalCode"
              mono
              dir="ltr"
              maxLength={20}
              defaultValue={initial?.postalCode ?? ""}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ts-country">{t.country}</Label>
            <Input
              id="ts-country"
              name="country"
              maxLength={80}
              defaultValue={initial?.country ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      {/* Invoicing contact */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionContact}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ts-email">{t.contactEmail}</Label>
            <Input
              id="ts-email"
              name="contactEmail"
              type="email"
              mono
              dir="ltr"
              maxLength={254}
              defaultValue={initial?.contactEmail ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ts-phone">{t.contactPhone}</Label>
            <Input
              id="ts-phone"
              name="contactPhone"
              mono
              dir="ltr"
              maxLength={40}
              defaultValue={initial?.contactPhone ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      {/* Readiness (note only — does NOT enable issuing) */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionReadiness}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="legalInvoicingReady"
              defaultChecked={initial?.legalInvoicingReady ?? false}
              className="mt-0.5 size-4 shrink-0 rounded-[4px] border-line-strong text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">
                {t.legalInvoicingReady}
              </span>
              <span className="mt-0.5 block text-[13px] text-ink-soft">
                {t.legalInvoicingReadyHint}
              </span>
            </span>
          </label>
          <div>
            <Label htmlFor="ts-readiness-notes">{t.readinessNotes}</Label>
            <Textarea
              id="ts-readiness-notes"
              name="readinessNotes"
              maxLength={2000}
              defaultValue={initial?.readinessNotes ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      {saveFailed ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
        >
          {t.saveError}
        </p>
      ) : null}

      {/* The ONLY action: Save. No issue / allocation / provider / payment
          / legal-download button exists. */}
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </form>
  );
}

function FlagRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-sm font-medium text-ink">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
