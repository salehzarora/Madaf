"use client";

import { Check, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  createCustomerLinkAction,
  regenerateCustomerLinkAction,
  revokeCustomerLinkAction,
} from "@/lib/actions/customer-links";
import { isDisplayablePublicUrl } from "@/lib/public-url";
import type { CustomerLink, LinkStatus } from "@/lib/data/customer-links";
import { formatDate } from "@/lib/format";

const EXPIRY_CHOICES = [0, 7, 30, 90] as const;

/**
 * Owner/admin management of a shop's private order links (Supabase mode).
 * The raw token is returned by the create action exactly once and shown in a
 * copy-now banner; the server only ever stores its hash.
 */
export function CustomerLinksManager({
  locale,
  dict,
  customerId,
  initialLinks,
  customerInactive = false,
}: {
  locale: Locale;
  dict: Dictionary;
  customerId: string;
  initialLinks: CustomerLink[];
  /** M8C — deactivated store: no new/regenerated links until reactivation. */
  customerInactive?: boolean;
}) {
  const t = dict.access.links;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Null when there is no error; otherwise the message to show (create or
  // revoke failure — both surface in the same banner).
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    // Do NOT clear the currently-displayed link up front — keep it if the
    // request fails (M8E.2), since a failed request revokes/creates nothing.
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createCustomerLinkAction({
        customerId,
        label: label.trim() || undefined,
        expiresInDays: expiryDays > 0 ? expiryDays : undefined,
        locale,
      });
      // The action returns the ABSOLUTE canonical URL, built + validated
      // server-side before any mutation (M8E.2). Display only a valid absolute
      // public link; on failure keep the previously displayed one.
      if (result.ok && isDisplayablePublicUrl(result.url)) {
        setCreatedUrl(result.url);
        setLabel("");
        setExpiryDays(0);
        router.refresh();
      } else {
        setError(
          result.reason === "config"
            ? dict.common.linkUrlError
            : result.reason === "inactive"
              ? t.inactiveError
              : t.error,
        );
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
      const result = await revokeCustomerLinkAction({
        linkId,
        customerId,
        locale,
      });
      if (!result.ok) setError(t.revokeError);
      router.refresh();
    });
  }

  // Regenerate = revoke the old link + issue a fresh one; the new URL lands
  // in the same copy-once banner (shown only here, only once).
  function onRegenerate(link: CustomerLink) {
    // Keep the current copy-once URL displayed until a replacement succeeds —
    // regeneration only revokes the old link on success (M8E.2).
    setError(null);
    setCopied(false);
    startTransition(async () => {
      // Carry the ORIGINAL expiry forward (M8A): regenerating an expiring
      // link must NEVER silently mint a never-expiring one. If the link had
      // ANY expiry — even one that lapsed between page render and the click —
      // the replacement keeps an expiry: at least 1 day, clamped to the
      // action's 365-day maximum. Only a truly never-expiring link
      // regenerates without one.
      const expiresInDays = link.expiresAt
        ? Math.min(
            365,
            Math.max(
              1,
              Math.ceil((Date.parse(link.expiresAt) - Date.now()) / 86_400_000),
            ),
          )
        : undefined;
      const result = await regenerateCustomerLinkAction({
        linkId: link.id,
        customerId,
        label: link.label ?? undefined,
        expiresInDays,
        locale,
      });
      if (result.ok && isDisplayablePublicUrl(result.url)) {
        setCreatedUrl(result.url);
        router.refresh();
      } else {
        setError(
          result.reason === "config"
            ? dict.common.linkUrlError
            : result.reason === "inactive"
              ? t.inactiveError
              : t.error,
        );
      }
    });
  }

  const statusTone: Record<LinkStatus, "success" | "danger" | "neutral"> = {
    active: "success",
    revoked: "danger",
    expired: "neutral",
  };
  const statusLabel: Record<LinkStatus, string> = {
    active: t.statusActive,
    revoked: t.statusRevoked,
    expired: t.statusExpired,
  };

  function expiryOptionLabel(days: number): string {
    if (days === 0) return t.expiryNever;
    return t.expiryDays.replace("{count}", String(days));
  }

  return (
    <div className="flex flex-col gap-5">
      {/* M8C: a deactivated store gets no new credentials — the create form
          is replaced by a clear notice (the RPC blocks regardless). */}
      {customerInactive ? (
        <p className="rounded-field bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          {t.inactiveError}
        </p>
      ) : null}

      {/* Create */}
      <div className={customerInactive ? "hidden" : "flex flex-col gap-4 sm:flex-row sm:items-end"}>
        <div className="flex-1">
          <Label htmlFor="link-label">{t.label}</Label>
          <Input
            id="link-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t.labelPlaceholder}
            maxLength={80}
          />
        </div>
        <div className="sm:w-44">
          <Label htmlFor="link-expiry">{t.expiry}</Label>
          <Select
            id="link-expiry"
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
          {pending ? t.generating : t.generate}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {/* Copy-once banner */}
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

      {/* List */}
      {initialLinks.length === 0 ? (
        <EmptyState icon={<Link2 />} title={t.empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-3 py-2.5 text-start">{t.colLabel}</th>
                <th className="px-3 py-2.5 text-start">{t.colStatus}</th>
                <th className="px-3 py-2.5 text-start">{t.colToken}</th>
                <th className="px-3 py-2.5 text-start">{t.colExpires}</th>
                <th className="px-3 py-2.5 text-start">{t.colLastUsed}</th>
                <th className="px-3 py-2.5 text-end">{dict.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {initialLinks.map((link) => {
                const status = link.status;
                return (
                  <tr
                    key={link.id}
                    className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-3 py-3 font-medium text-ink">
                      {link.label || t.none}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[status]} dot>
                        {statusLabel[status]}
                      </Badge>
                    </td>
                    <td
                      className="px-3 py-3 font-mono text-[13px] text-ink-soft"
                      dir="ltr"
                    >
                      {link.tokenPreview ? `…${link.tokenPreview}` : t.none}
                    </td>
                    <td className="px-3 py-3 text-ink-muted">
                      {link.expiresAt
                        ? formatDate(link.expiresAt, locale)
                        : t.never}
                    </td>
                    <td className="px-3 py-3 text-ink-muted">
                      {link.lastUsedAt
                        ? formatDate(link.lastUsedAt, locale)
                        : t.none}
                    </td>
                    <td className="px-3 py-3 text-end">
                      {status === "active" ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          {/* No regeneration for a deactivated store (M8C);
                              revoke stays available. */}
                          {customerInactive ? null : (
                          <button
                            type="button"
                            onClick={() => onRegenerate(link)}
                            disabled={pending}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
                          >
                            <RefreshCw className="size-3.5" aria-hidden />
                            {t.regenerate}
                          </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRevoke(link.id)}
                            disabled={pending}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {t.revoke}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-muted">{t.none}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-muted">{t.regenerateHint}</p>
    </div>
  );
}
