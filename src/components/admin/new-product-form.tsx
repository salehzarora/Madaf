"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import { categories, manufacturers } from "@/lib/mock";

/**
 * Mock "new product" form. Submitting shows a success banner only —
 * nothing is persisted in this phase (stated in the UI).
 */
export function NewProductForm({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const t = dict.admin.products.new;
  const [saved, setSaved] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
      <p className="rounded-field bg-info-soft px-4 py-3 text-sm text-info">
        {t.mockNotice}
      </p>

      {saved ? (
        <div className="flex items-center gap-3 rounded-field bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {t.savedToast}
          <Link
            href={`/${locale}/admin/products`}
            className="ms-auto shrink-0 underline"
          >
            {t.backToList}
          </Link>
        </div>
      ) : null}

      {/* Names & translations */}
      <Card>
        <CardHeader>
          <CardTitle>{t.sectionTranslations}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          <div>
            <Label htmlFor="np-he">{t.nameHe}</Label>
            <Input id="np-he" dir="rtl" lang="he" required />
          </div>
          <div>
            <Label htmlFor="np-ar">{t.nameAr}</Label>
            <Input id="np-ar" dir="rtl" lang="ar" required />
          </div>
          <div>
            <Label htmlFor="np-en">{t.nameEn}</Label>
            <Input id="np-en" dir="ltr" lang="en" />
          </div>
        </CardContent>
      </Card>

      {/* Basics */}
      <Card>
        <CardHeader>
          <CardTitle>{t.sectionBasics}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="np-cat">{t.category}</Label>
            <Select id="np-cat" required defaultValue="">
              <option value="" disabled>
                {dict.common.select}…
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name[locale]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-man">{t.manufacturer}</Label>
            <Select id="np-man" required defaultValue="">
              <option value="" disabled>
                {dict.common.select}…
              </option>
              {manufacturers.map((manufacturer) => (
                <option key={manufacturer.id} value={manufacturer.id}>
                  {manufacturer.name[locale]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Packaging */}
      <Card>
        <CardHeader>
          <CardTitle>{t.sectionPackaging}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="np-ptype">{t.packageType}</Label>
            <Select id="np-ptype" defaultValue="carton">
              {(["carton", "pack", "unit"] as const).map((p) => (
                <option key={p} value={p}>
                  {dict.packaging[p]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-upp">{t.unitsPerPackage}</Label>
            <Input id="np-upp" type="number" min={1} defaultValue={24} dir="ltr" />
          </div>
          <div>
            <Label htmlFor="np-unit">{t.baseUnit}</Label>
            <Select id="np-unit" defaultValue="units">
              {(
                Object.keys(dict.units) as (keyof typeof dict.units)[]
              ).map((u) => (
                <option key={u} value={u}>
                  {dict.units[u]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Pricing & stock */}
      <Card>
        <CardHeader>
          <CardTitle>{t.sectionPricing}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="np-price">{t.wholesalePrice}</Label>
            <Input
              id="np-price"
              type="number"
              min={0}
              step="0.1"
              required
              dir="ltr"
            />
          </div>
          <div>
            <Label htmlFor="np-avail">{t.availability}</Label>
            <Select id="np-avail" defaultValue="inStock">
              {(["inStock", "lowStock", "outOfStock"] as const).map((a) => (
                <option key={a} value={a}>
                  {dict.availability[a]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-start gap-3 rounded-field border border-line p-3 sm:col-span-2">
            <input type="checkbox" className="mt-1 size-4 accent-brand-600" />
            <span>
              <span className="block text-sm font-medium text-ink">
                {t.trackExpiry}
              </span>
              <span className="block text-xs text-ink-muted">
                {t.trackExpiryHint}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg">
          {t.save}
        </Button>
        <Link
          href={`/${locale}/admin/products`}
          className="inline-flex h-12 items-center rounded-field px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
        >
          {dict.common.cancel}
        </Link>
      </div>
    </form>
  );
}
