"use client";

import { Check, Copy, Link2, Store, Trash2, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/types";
import {
  approveSignupRequestAction,
  createSignupLinkAction,
  rejectSignupRequestAction,
  revokeSignupLinkAction,
} from "@/lib/actions/customer-signup";
import type { CustomerDuplicate } from "@/lib/data/customers";
import type {
  SignupLink,
  SignupLinkStatus,
  SignupRequest,
  SignupRequestStatus,
} from "@/lib/data/customer-signup";
import { formatDate } from "@/lib/format";
import { absolutePublicUrl } from "@/lib/public-url";

const EXPIRY_CHOICES = [0, 7, 30, 90] as const;

/** Owner/admin management of new-store signup links + pending requests. */
export function SignupManager({
  locale,
  dict,
  initialLinks,
  initialRequests,
}: {
  locale: Locale;
  dict: Dictionary;
  initialLinks: SignupLink[];
  initialRequests: SignupRequest[];
}) {
  const t = dict.admin.customers.signup;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [expiryDays, setExpiryDays] = useState(0);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M8B.3 — pending duplicate-store warning for an approval attempt.
  const [dupWarning, setDupWarning] = useState<{
    requestId: string;
    duplicates: CustomerDuplicate[];
  } | null>(null);

  function onGenerate() {
    setError(null);
    setCreatedUrl(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createSignupLinkAction({
        label: label.trim() || undefined,
        expiresInDays: expiryDays > 0 ? expiryDays : undefined,
        locale,
      });
      if (result.ok && result.url) {
        // Build the shareable link from the CANONICAL app origin, never the
        // current (possibly preview) browser origin (M8E.2).
        const publicUrl = absolutePublicUrl(result.url);
        if (!publicUrl) {
          setError(dict.common.linkUrlError);
          return;
        }
        setCreatedUrl(publicUrl);
        setLabel("");
        setExpiryDays(0);
        router.refresh();
      } else {
        setError(t.error);
      }
    });
  }

  async function onCopy() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function onRevoke(linkId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeSignupLinkAction({ linkId, locale });
      if (!result.ok) setError(t.error);
      router.refresh();
    });
  }

  function onApprove(requestId: string, confirmDuplicate = false) {
    setError(null);
    setDupWarning(null);
    startTransition(async () => {
      const result = await approveSignupRequestAction({
        requestId,
        locale,
        confirmDuplicate,
      });
      if (result.ok) {
        router.refresh();
        return;
      }
      // M8B.3 duplicate guard — an existing store shares this request's
      // phone/name; approval needs an explicit confirmation.
      if (result.duplicates && result.duplicates.length > 0) {
        setDupWarning({ requestId, duplicates: result.duplicates });
        return;
      }
      setError(t.error);
      router.refresh();
    });
  }

  function onReject(requestId: string) {
    setError(null);
    startTransition(async () => {
      const result = await rejectSignupRequestAction({ requestId, locale });
      if (!result.ok) setError(t.error);
      router.refresh();
    });
  }

  const linkStatusTone: Record<SignupLinkStatus, "success" | "danger" | "neutral"> = {
    active: "success",
    revoked: "danger",
    expired: "neutral",
  };
  const linkStatusLabel: Record<SignupLinkStatus, string> = {
    active: t.statusActive,
    revoked: t.statusRevoked,
    expired: t.statusExpired,
  };
  const reqStatusTone: Record<SignupRequestStatus, "warning" | "success" | "neutral"> = {
    pending: "warning",
    approved: "success",
    rejected: "neutral",
  };
  const reqStatusLabel: Record<SignupRequestStatus, string> = {
    pending: t.statusPending,
    approved: t.statusApproved,
    rejected: t.statusRejected,
  };

  function expiryOptionLabel(days: number): string {
    return days === 0 ? t.expiryNever : interpolate(t.expiryDays, { count: days });
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {/* M8B.3 — duplicate-store warning for a pending approval */}
      {dupWarning ? (
        <div className="flex flex-col gap-2 rounded-field border border-warning/45 bg-warning-soft p-4">
          <p className="text-sm font-bold text-warning">{t.duplicateTitle}</p>
          <ul className="flex flex-col gap-1.5">
            {dupWarning.duplicates.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-field bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                    {d.name}
                    {d.isActive === false ? (
                      <span className="shrink-0 rounded-badge bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
                        {dict.admin.customers.lifecycle.inactiveBadge}
                      </span>
                    ) : null}
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
                  {t.viewStore}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => onApprove(dupWarning.requestId, true)}
            >
              {t.approveAnyway}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setDupWarning(null)}
            >
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Create + list links ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-ink-muted">
          {t.linksTitle}
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="su-label">{t.colLink}</Label>
            <Input
              id="su-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="sm:w-44">
            <Label htmlFor="su-expiry">{t.expiry}</Label>
            <Select
              id="su-expiry"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
            >
              {EXPIRY_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {expiryOptionLabel(days)}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={onGenerate} disabled={pending} className="sm:w-auto">
            <Link2 className="size-4" aria-hidden />
            {pending ? t.creating : t.createLink}
          </Button>
        </div>

        {createdUrl ? (
          <div className="rounded-card border border-success/30 bg-success-soft p-4">
            <p className="text-sm font-semibold text-success">{t.createdTitle}</p>
            <p className="mt-0.5 text-xs text-ink-soft">{t.createdHint}</p>
            <div className="mt-3 flex items-center gap-2">
              <code
                dir="ltr"
                className="min-w-0 flex-1 truncate rounded-field border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
              >
                {createdUrl}
              </code>
              <Button variant="outline" size="sm" onClick={onCopy}>
                {copied ? (
                  <Check className="size-4 text-success" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? t.copied : t.copy}
              </Button>
            </div>
          </div>
        ) : null}

        {initialLinks.length === 0 ? (
          <EmptyState icon={<Link2 />} title={t.noLinks} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-3 py-2.5 text-start">{t.colLink}</th>
                  <th className="px-3 py-2.5 text-start">{t.colStatus}</th>
                  <th className="px-3 py-2.5 text-start">{t.colToken}</th>
                  <th className="px-3 py-2.5 text-start">{t.colExpires}</th>
                  <th className="px-3 py-2.5 text-end">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {initialLinks.map((link) => (
                  <tr
                    key={link.id}
                    className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-3 py-3 font-medium text-ink">
                      {link.label || t.none}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={linkStatusTone[link.status]} dot>
                        {linkStatusLabel[link.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                      {link.tokenPreview ? `…${link.tokenPreview}` : t.none}
                    </td>
                    <td className="px-3 py-3 text-ink-muted">
                      {link.expiresAt ? formatDate(link.expiresAt, locale) : t.never}
                    </td>
                    <td className="px-3 py-3 text-end">
                      {link.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => onRevoke(link.id)}
                          disabled={pending}
                          className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          {t.revoke}
                        </button>
                      ) : (
                        <span className="text-xs text-ink-muted">{t.none}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Requests ── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-ink-muted">
            {t.requestsTitle}
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">{t.requestsSubtitle}</p>
        </div>
        {initialRequests.length === 0 ? (
          <EmptyState icon={<Store />} title={t.noRequests} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-3 py-2.5 text-start">{t.colStore}</th>
                  <th className="px-3 py-2.5 text-start">{t.colContact}</th>
                  <th className="px-3 py-2.5 text-start">{t.colSubmitted}</th>
                  <th className="px-3 py-2.5 text-start">{t.colStatus}</th>
                  <th className="px-3 py-2.5 text-end">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {initialRequests.map((req) => (
                  <tr
                    key={req.id}
                    className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{req.name}</p>
                      <p className="text-xs text-ink-muted">
                        {[req.city[locale], req.address].filter(Boolean).join(" · ") || t.none}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-ink-soft">
                      <p>{req.contactName || t.none}</p>
                      {req.phone ? (
                        <p className="font-mono text-[13px]" dir="ltr">
                          {req.phone}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-ink-muted">
                      {formatDate(req.createdAt, locale)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={reqStatusTone[req.status]} dot>
                        {reqStatusLabel[req.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-end">
                      {req.status === "pending" ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onApprove(req.id)}
                            disabled={pending}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field bg-brand-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
                          >
                            <UserCheck className="size-3.5" aria-hidden />
                            {t.approve}
                          </button>
                          <button
                            type="button"
                            onClick={() => onReject(req.id)}
                            disabled={pending}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
                          >
                            <X className="size-3.5" aria-hidden />
                            {t.reject}
                          </button>
                        </div>
                      ) : req.status === "approved" && req.approvedCustomerId ? (
                        <Link
                          href={`/${locale}/admin/customers/${req.approvedCustomerId}`}
                          className="text-xs font-semibold text-brand-700 underline"
                        >
                          {t.viewStore}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-muted">{t.none}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
