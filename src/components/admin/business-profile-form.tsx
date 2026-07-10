"use client";

import { CheckCircle2, Factory, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { saveBusinessProfileAction } from "@/lib/actions/tenant";
import { uploadTenantLogoAction } from "@/lib/actions/products";
import {
  IMAGE_ACCEPT,
  MAX_LOGO_BYTES,
  preValidateImage,
  type UploadReason,
} from "@/lib/image-upload";
import type { Supplier } from "@/lib/types";

const EXTERNAL_URL = /^https?:\/\//i;

/**
 * Tenant business/profile settings form (M8E.4). NON-LEGAL: it edits the
 * display identity that appears on documents (name / phone / email / address /
 * legal name / company id / logo) plus a DISPLAY VAT rate used only for draft
 * estimates. A permanent note states it issues no legal invoice. Mock mode
 * shows a demo confirmation and persists nothing.
 */
export function BusinessProfileForm({
  locale,
  dict,
  initial,
  live,
}: {
  locale: Locale;
  dict: Dictionary;
  initial: Supplier;
  live: boolean;
}) {
  const t = dict.admin.settings.business;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // Logo: track the value to PERSIST (path or external URL) vs the display
  // preview, so an edit never re-persists an ephemeral signed URL.
  const initialLogoValue = initial.logoStoragePath ?? initial.logoUrl ?? "";
  const [logoValue, setLogoValue] = useState(initialLogoValue);
  const [logoPreview, setLogoPreview] = useState<string | undefined>(
    initial.logoUrl,
  );
  const [logoUrlText, setLogoUrlText] = useState(
    EXTERNAL_URL.test(initialLogoValue) ? initialLogoValue : "",
  );
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const vatPercent =
    initial.displayVatRate != null
      ? Number((initial.displayVatRate * 100).toFixed(2))
      : undefined;

  function logoReasonMessage(reason?: UploadReason): string {
    return reason === "type"
      ? t.uploadTypeError
      : reason === "size"
        ? t.uploadSizeError
        : reason === "invalid"
          ? dict.common.uploadInvalid
          : t.uploadFailed;
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file (even after error)
    if (!file) return;
    setLogoError(null);
    // Fast client-side reject before any upload starts (server re-validates).
    const pre = preValidateImage(file, MAX_LOGO_BYTES);
    if (pre) {
      setLogoError(logoReasonMessage(pre));
      return;
    }
    if (!live) {
      setLogoPreview(URL.createObjectURL(file));
      setLogoUrlText("");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const result = await uploadTenantLogoAction(fd);
      if (result.ok && result.path) {
        setLogoValue(result.path);
        setLogoPreview(result.previewUrl);
        setLogoUrlText("");
      } else {
        // The current logo/preview is untouched — only surface the error.
        setLogoError(logoReasonMessage(result.reason));
      }
    } catch {
      // Rejected promise (network / body-size / server error) — reset state so
      // the button never stays stuck on "uploading" (M8E.1 hotfix).
      setLogoError(t.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  function onLogoUrl(event: React.ChangeEvent<HTMLInputElement>) {
    const v = event.target.value;
    setLogoUrlText(v);
    setLogoValue(v);
    setLogoPreview(v || undefined);
    setLogoError(null);
  }

  function removeLogo() {
    setLogoValue("");
    setLogoPreview(undefined);
    setLogoUrlText("");
    setLogoError(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveFailed(false);
    setSaved(false);
    const fd = new FormData(event.currentTarget);
    const text = (v: FormDataEntryValue | null): string | undefined => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || undefined;
    };

    if (!live) {
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);
    try {
      const result = await saveBusinessProfileAction({
        nameAr: (text(fd.get("nameAr")) ?? ""),
        nameHe: (text(fd.get("nameHe")) ?? ""),
        nameEn: (text(fd.get("nameEn")) ?? ""),
        phone: text(fd.get("phone")),
        email: text(fd.get("email")),
        addressAr: text(fd.get("addressAr")),
        addressHe: text(fd.get("addressHe")),
        addressEn: text(fd.get("addressEn")),
        legalName: text(fd.get("legalName")),
        companyId: text(fd.get("companyId")),
        displayVatRatePct: text(fd.get("displayVatRatePct")) ?? null,
        logoUrl: logoValue,
        locale,
      });
      if (result.ok) {
        setSaved(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setSaveFailed(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {saved ? (
        <p className="flex items-center gap-2 rounded-field bg-success-soft px-3 py-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {t.savedToast}
        </p>
      ) : null}

      {!live ? (
        <p className="rounded-field bg-info-soft px-3 py-2 text-sm text-info">
          {t.mockNotice}
        </p>
      ) : null}

      {/* Identity */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionIdentity}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="b-name-he">{t.nameHe}</Label>
            <Input id="b-name-he" name="nameHe" dir="rtl" lang="he" required
              defaultValue={initial.name.he} />
          </div>
          <div>
            <Label htmlFor="b-name-ar">{t.nameAr}</Label>
            <Input id="b-name-ar" name="nameAr" dir="rtl" lang="ar" required
              defaultValue={initial.name.ar} />
          </div>
          <div>
            <Label htmlFor="b-name-en">{t.nameEn}</Label>
            <Input id="b-name-en" name="nameEn" dir="ltr" lang="en" required
              defaultValue={initial.name.en} />
          </div>
          <div>
            <Label htmlFor="b-legal">{t.legalName}</Label>
            <Input id="b-legal" name="legalName" defaultValue={initial.legalName} />
          </div>
          <div>
            <Label htmlFor="b-company">{t.companyId}</Label>
            <Input id="b-company" name="companyId" dir="ltr"
              defaultValue={initial.companyId} />
          </div>
          <div>
            <Label htmlFor="b-vat">{t.displayVatRate}</Label>
            <Input id="b-vat" name="displayVatRatePct" dir="ltr" type="number"
              min="0" max="99.99" step="0.01" defaultValue={vatPercent} />
            <p className="mt-1 text-xs text-ink-muted">{t.displayVatRateHint}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionContact}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="b-phone">{t.phone}</Label>
            <Input id="b-phone" name="phone" dir="ltr" defaultValue={initial.phone} />
          </div>
          <div>
            <Label htmlFor="b-email">{t.email}</Label>
            <Input id="b-email" name="email" dir="ltr" type="email"
              defaultValue={initial.email} />
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionAddress}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="b-addr-he">{t.addressHe}</Label>
            <Input id="b-addr-he" name="addressHe" dir="rtl" lang="he"
              defaultValue={initial.address.he} />
          </div>
          <div>
            <Label htmlFor="b-addr-ar">{t.addressAr}</Label>
            <Input id="b-addr-ar" name="addressAr" dir="rtl" lang="ar"
              defaultValue={initial.address.ar} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="b-addr-en">{t.addressEn}</Label>
            <Input id="b-addr-en" name="addressEn" dir="ltr" lang="en"
              defaultValue={initial.address.en} />
          </div>
        </CardContent>
      </Card>

      {/* Branding / logo */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionBranding}</CardTitle>
        </CardHeader>
        <CardContent>
          <Label>{t.logo}</Label>
          <div className="flex flex-wrap items-center gap-3">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt=""
                className="size-12 rounded-field border border-line object-cover"
              />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-field bg-brand-50 text-brand-700">
                <Factory className="size-5" aria-hidden />
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="size-3.5" aria-hidden />
              {uploading ? t.uploading : t.uploadLogo}
            </Button>
            {logoValue ? (
              <button
                type="button"
                onClick={removeLogo}
                className="inline-flex h-9 items-center gap-1 rounded-field px-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <X className="size-3.5" aria-hidden />
                {t.removeLogo}
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={onFile}
            />
          </div>
          <Input
            dir="ltr"
            value={logoUrlText}
            onChange={onLogoUrl}
            placeholder="https://…"
            aria-label={t.logoOrUrl}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-ink-muted">{t.logoOrUrl}</p>
          <p className="mt-1 text-xs text-ink-muted">{t.logoHelp}</p>
          {logoError ? (
            <div className="mt-1">
              <p role="alert" className="text-[13px] font-medium text-danger">
                {logoError}
              </p>
              <p className="text-xs text-ink-muted">
                {dict.common.uploadKeepCurrent}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* PERMANENT non-legal note */}
      <p className="rounded-field border border-dashed border-line-strong bg-surface-warm px-3 py-2 text-[13px] text-ink-soft">
        {t.nonLegalNote}
      </p>

      {saveFailed ? (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {t.saveError}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={saving}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </form>
  );
}
