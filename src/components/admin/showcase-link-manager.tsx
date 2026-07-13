"use client";

import { Check, Copy, Eye, Trash2 } from "lucide-react";
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
  createShowcaseLinkAction,
  revokeShowcaseLinkAction,
} from "@/lib/actions/catalog-showcase";
import type {
  ShowcaseLink,
  ShowcaseLinkStatus,
} from "@/lib/data/catalog-showcase";
import { formatTenantDateTime } from "@/lib/time";
import { isDisplayablePublicUrl } from "@/lib/public-url";
import { linkErrorMessage } from "./link-error-message";

const EXPIRY_CHOICES = [0, 7, 30, 90] as const;

/** Owner/admin management of view-only product-showcase links (M7H.3).
 * Reuses the signup dictionary vocabulary; only the section title differs. */
export function ShowcaseLinkManager({
  locale,
  dict,
  initialLinks,
  timeZone,
}: {
  locale: Locale;
  dict: Dictionary;
  initialLinks: ShowcaseLink[];
  /** M8H.2 — the tenant's IANA zone (server-derived). */
  timeZone: string;
}) {
  const t = dict.admin.customers.signup;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [expiryDays, setExpiryDays] = useState(0);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    // Keep any currently-displayed link until a replacement succeeds (M8E.2).
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const result = await createShowcaseLinkAction({
          label: label.trim() || undefined,
          expiresInDays: expiryDays > 0 ? expiryDays : undefined,
          locale,
        });
        // The action returns the EXACT ABSOLUTE canonical URL, built + validated
        // server-side before any mutation (M8E.2). Show it only if it is the
        // exact canonical showcase link; on failure keep any prior link.
        if (
          result.ok &&
          isDisplayablePublicUrl(result.url, { locale, routeType: "showcase" })
        ) {
          setCreatedUrl(result.url);
          setLabel("");
          setExpiryDays(0);
          router.refresh();
        } else {
          setError(linkErrorMessage(dict.common, result.reason));
        }
      } catch {
        // Transport/network rejection: outcome unknown. A showcase link is an
        // INDEPENDENT insert (it revokes nothing), so any previously-shown link
        // stays valid and is kept. Show a generic error and reconcile the list;
        // if the insert did commit, the new one-time URL was lost — regenerate.
        setError(dict.common.actionError);
        router.refresh();
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
      try {
        const result = await revokeShowcaseLinkAction({ linkId, locale });
        if (!result.ok) setError(t.error);
      } catch {
        setError(dict.common.actionError);
      } finally {
        router.refresh();
      }
    });
  }

  const statusTone: Record<ShowcaseLinkStatus, "success" | "danger" | "neutral"> = {
    active: "success",
    revoked: "danger",
    expired: "neutral",
  };
  const statusLabel: Record<ShowcaseLinkStatus, string> = {
    active: t.statusActive,
    revoked: t.statusRevoked,
    expired: t.statusExpired,
  };
  const expiryOptionLabel = (days: number) =>
    days === 0 ? t.expiryNever : interpolate(t.expiryDays, { count: days });

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.06em] text-ink-muted">
          <Eye className="size-4" aria-hidden />
          {t.showcaseTitle}
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">{t.showcaseSubtitle}</p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="sc-label">{t.colLink}</Label>
          <Input
            id="sc-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="sm:w-44">
          <Label htmlFor="sc-expiry">{t.expiry}</Label>
          <Select
            id="sc-expiry"
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
          <Eye className="size-4" aria-hidden />
          {pending ? t.creating : t.showcaseCreate}
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
        <EmptyState icon={<Eye />} title={t.showcaseNoLinks} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
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
                    <Badge tone={statusTone[link.status]} dot>
                      {statusLabel[link.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {link.tokenPreview ? `…${link.tokenPreview}` : t.none}
                  </td>
                  <td className="px-3 py-3 text-ink-muted">
                    {link.expiresAt
                      ? formatTenantDateTime(link.expiresAt, locale, timeZone)
                      : t.never}
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
  );
}
