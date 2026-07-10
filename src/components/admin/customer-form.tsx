"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  createCustomerAction,
  updateCustomerAction,
} from "@/lib/actions/customers";
import type { CustomerDuplicate } from "@/lib/data/customers";
import { getDataMode } from "@/lib/data/mode";
import type { Customer, CustomerType } from "@/lib/types";
import { cn } from "@/lib/utils";

const CUSTOMER_TYPES: CustomerType[] = [
  "grocery",
  "kiosk",
  "supermarket",
  "minimarket",
];

/**
 * Shared admin store/customer form — create and edit (M7F.2).
 * - Mock mode: shows the demo confirmation, persists nothing.
 * - Supabase mode: submits through the customer Server Actions (real
 *   create/update; create_customer / update_customer validate + enforce
 *   owner/admin in Postgres).
 */
export function CustomerForm({
  locale,
  dict,
  customer,
}: {
  locale: Locale;
  dict: Dictionary;
  /** Present in edit mode. */
  customer?: Customer;
}) {
  const t = dict.admin.customers.form;
  const router = useRouter();
  const isEdit = Boolean(customer);
  const live = getDataMode() === "supabase";

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // M8B.3 — existing same-phone/name stores; creating needs confirmation.
  const [duplicates, setDuplicates] = useState<CustomerDuplicate[] | null>(
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save(event.currentTarget, false);
  }

  async function save(form: HTMLFormElement, confirmDuplicate: boolean) {
    setSaveFailed(false);
    setDuplicates(null);

    if (!live) {
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const fd = new FormData(form);
    const customerInput = {
      name: fd.get("name"),
      type: fd.get("type"),
      contactName: fd.get("contactName") || undefined,
      phone: fd.get("phone") || undefined,
      address: fd.get("address") || undefined,
      cityHe: fd.get("cityHe") || undefined,
      cityAr: fd.get("cityAr") || undefined,
      cityEn: fd.get("cityEn") || undefined,
      notes: fd.get("notes") || undefined,
    };

    setSaving(true);
    try {
      const result =
        isEdit && customer
          ? await updateCustomerAction({
              customerId: customer.id,
              customer: customerInput,
              locale,
            })
          : await createCustomerAction({
              customer: customerInput,
              locale,
              confirmDuplicate,
            });
      if (result.ok) {
        router.push(`/${locale}/admin/customers`);
        router.refresh();
        return;
      }
      // Duplicate guard (create only): show matches; the admin can confirm.
      if (!isEdit && "duplicates" in result && result.duplicates?.length) {
        setDuplicates(result.duplicates);
        setSaving(false);
        return;
      }
    } catch {
      // fall through to the error state
    }
    setSaving(false);
    setSaveFailed(true);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      <p
        className={cn(
          "rounded-field px-4 py-3 text-sm",
          live ? "bg-success-soft text-success" : "bg-info-soft text-info",
        )}
      >
        {live ? t.liveNotice : t.mockNotice}
      </p>

      {saved ? (
        <div className="flex items-center gap-3 rounded-field bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {t.savedToast}
          <Link
            href={`/${locale}/admin/customers`}
            className="ms-auto shrink-0 underline"
          >
            {t.backToList}
          </Link>
        </div>
      ) : null}

      {/* Basics */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionBasics}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <Label htmlFor="cf-name">{t.name}</Label>
            <Input
              id="cf-name"
              name="name"
              required
              defaultValue={customer?.name}
            />
            <p className="mt-1 text-xs text-ink-soft">{t.nameHint}</p>
          </div>
          <div>
            <Label htmlFor="cf-type">{t.type}</Label>
            <Select
              id="cf-type"
              name="type"
              defaultValue={customer?.type ?? "grocery"}
            >
              {CUSTOMER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {dict.admin.customers.types[type]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Contact & address */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionContact}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cf-contact">{t.contactName}</Label>
            <Input
              id="cf-contact"
              name="contactName"
              defaultValue={customer?.contactName}
            />
          </div>
          <div>
            <Label htmlFor="cf-phone">{t.phone}</Label>
            <Input
              id="cf-phone"
              name="phone"
              dir="ltr"
              defaultValue={customer?.phone}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cf-address">{t.address}</Label>
            <Input
              id="cf-address"
              name="address"
              defaultValue={customer?.address}
            />
          </div>
          <div>
            <Label htmlFor="cf-city-he">{t.cityHe}</Label>
            <Input
              id="cf-city-he"
              name="cityHe"
              dir="rtl"
              lang="he"
              defaultValue={customer?.city.he}
            />
          </div>
          <div>
            <Label htmlFor="cf-city-ar">{t.cityAr}</Label>
            <Input
              id="cf-city-ar"
              name="cityAr"
              dir="rtl"
              lang="ar"
              defaultValue={customer?.city.ar}
            />
          </div>
          <div>
            <Label htmlFor="cf-city-en">{t.cityEn}</Label>
            <Input
              id="cf-city-en"
              name="cityEn"
              dir="ltr"
              lang="en"
              defaultValue={customer?.city.en}
            />
          </div>
          <p className="text-xs text-ink-soft sm:col-span-2">{t.cityHint}</p>
          <div className="sm:col-span-2">
            <Label htmlFor="cf-notes">{t.notes}</Label>
            <Textarea
              id="cf-notes"
              name="notes"
              maxLength={2000}
              defaultValue={customer?.notes}
            />
            <p className="mt-1 text-xs text-ink-soft">{t.notesHint}</p>
          </div>
        </CardContent>
      </Card>

      {/* M8B.3 — duplicate-store warning (create mode) */}
      {duplicates ? (
        <div className="flex flex-col gap-2 rounded-field border border-warning/45 bg-warning-soft p-4">
          <p className="text-sm font-bold text-warning">{t.duplicateTitle}</p>
          <ul className="flex flex-col gap-1.5">
            {duplicates.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-field bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {d.name}
                  </span>
                  <span className="block text-xs text-ink-soft">
                    {d.matchType === "phone"
                      ? t.duplicatePhoneMatch
                      : t.duplicateNameMatch}
                    {d.phone ? <span dir="ltr"> · {d.phone}</span> : null}
                  </span>
                </span>
                <Link
                  href={`/${locale}/admin/customers/${d.id}`}
                  className="text-xs font-semibold text-brand-700 underline"
                >
                  {dict.admin.customers.signup.viewStore}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => formRef.current && save(formRef.current, true)}
            >
              {t.createAnyway}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setDuplicates(null)}
            >
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {saveFailed ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
        >
          {t.saveError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t.saving : t.save}
        </Button>
        <Link
          href={`/${locale}/admin/customers`}
          className="inline-flex h-12 items-center rounded-field px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {dict.common.cancel}
        </Link>
      </div>
    </form>
  );
}
