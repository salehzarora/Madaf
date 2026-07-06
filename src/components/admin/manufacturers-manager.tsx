"use client";

import { CheckCircle2, Factory, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  createManufacturerAction,
  updateManufacturerAction,
} from "@/lib/actions/products";
import { getDataMode } from "@/lib/data/mode";
import type { Manufacturer } from "@/lib/types";

/** Small brand avatar: logo if present, else a factory glyph. */
function LogoAvatar({ manufacturer }: { manufacturer: Manufacturer }) {
  if (manufacturer.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={manufacturer.logoUrl}
        alt=""
        className="size-10 rounded-field border border-line object-cover"
      />
    );
  }
  return (
    <span className="flex size-10 items-center justify-center rounded-field bg-brand-50 text-brand-700">
      <Factory className="size-4" aria-hidden />
    </span>
  );
}

/**
 * Manufacturers admin — list + inline create/edit form.
 * Mock mode: the form shows a demo confirmation, persists nothing.
 * Supabase mode: submits through the manufacturer Server Actions.
 */
export function ManufacturersManager({
  manufacturers,
  productCounts,
  locale,
  dict,
}: {
  manufacturers: Manufacturer[];
  productCounts: Record<string, number>;
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.manufacturers;
  const live = getDataMode() === "supabase";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Manufacturer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bump to remount the form (reset uncontrolled inputs) when target changes.
  const [formKey, setFormKey] = useState(0);

  function openAdd() {
    setEditing(null);
    setSaved(false);
    setFailed(false);
    setFormOpen(true);
    setFormKey((k) => k + 1);
  }
  function openEdit(manufacturer: Manufacturer) {
    setEditing(manufacturer);
    setSaved(false);
    setFailed(false);
    setFormOpen(true);
    setFormKey((k) => k + 1);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const fd = new FormData(event.currentTarget);
    const input = {
      nameHe: fd.get("nameHe"),
      nameAr: fd.get("nameAr"),
      nameEn: fd.get("nameEn"),
      logoUrl: fd.get("logoUrl") || undefined,
    };

    if (!live) {
      setSaved(true);
      setFormOpen(false);
      return;
    }

    startTransition(async () => {
      const result = editing
        ? await updateManufacturerAction({
            manufacturerId: editing.id,
            manufacturer: input,
            locale,
          })
        : await createManufacturerAction({ manufacturer: input, locale });
      if (result.ok) {
        setSaved(true);
        setFormOpen(false);
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {saved ? (
          <p className="flex items-center gap-2 rounded-field bg-success-soft px-3 py-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            {t.savedToast}
          </p>
        ) : (
          <span />
        )}
        {!formOpen ? (
          <Button type="button" onClick={openAdd}>
            <Plus className="size-4" aria-hidden />
            {t.add}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <Card key={formKey}>
          <CardHeader variant="strip">
            <CardTitle>{editing ? t.editTitle : t.addTitle}</CardTitle>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              aria-label={dict.common.close}
              className="rounded-field p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <X className="size-4" />
            </button>
          </CardHeader>
          <CardContent>
            {!live ? (
              <p className="mb-4 rounded-field bg-info-soft px-3 py-2 text-sm text-info">
                {t.mockNotice}
              </p>
            ) : null}
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="m-he">{t.nameHe}</Label>
                <Input id="m-he" name="nameHe" dir="rtl" lang="he" required
                  defaultValue={editing?.name.he} />
              </div>
              <div>
                <Label htmlFor="m-ar">{t.nameAr}</Label>
                <Input id="m-ar" name="nameAr" dir="rtl" lang="ar" required
                  defaultValue={editing?.name.ar} />
              </div>
              <div>
                <Label htmlFor="m-en">{t.nameEn}</Label>
                <Input id="m-en" name="nameEn" dir="ltr" lang="en" required
                  defaultValue={editing?.name.en} />
              </div>
              <div>
                <Label htmlFor="m-logo">{t.logoUrl}</Label>
                <Input id="m-logo" name="logoUrl" dir="ltr"
                  defaultValue={editing?.logoUrl} />
                <p className="mt-1 text-xs text-ink-muted">{t.logoUrlHint}</p>
              </div>
              {failed ? (
                <p role="alert" className="text-[13px] font-medium text-danger sm:col-span-2">
                  {t.saveError}
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t.saving : t.save}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
              <th className="px-4 py-3 text-start">{t.colName}</th>
              <th className="px-4 py-3 text-end">{dict.nav.products}</th>
              {live ? (
                <th className="px-4 py-3 text-end">{t.colActions}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {manufacturers.map((manufacturer) => (
              <tr
                key={manufacturer.id}
                className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
              >
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <LogoAvatar manufacturer={manufacturer} />
                    <span className="font-medium text-ink">
                      {manufacturer.name[locale]}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-end font-mono text-[13px] tabular-nums text-ink-soft">
                  {productCounts[manufacturer.id] ?? 0}
                </td>
                {live ? (
                  <td className="px-4 py-3.5 text-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(manufacturer)}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      {t.edit}
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
