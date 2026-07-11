"use client";

import {
  Check,
  Copy,
  Mail,
  ShieldMinus,
  ShieldPlus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { TenantRole } from "@/lib/auth/session";
import {
  createInviteAction,
  demoteOwnerAction,
  promoteOwnerAction,
  removeMemberAction,
  revokeInviteAction,
  updateMemberRoleAction,
} from "@/lib/actions/team";
import type { InviteStatus, TenantInvite, TenantMember } from "@/lib/data/team";
import { formatDate } from "@/lib/format";
import { isDisplayablePublicUrl } from "@/lib/public-url";
import { cn } from "@/lib/utils";

const INVITE_ROLES = ["admin", "sales_rep"] as const;
const EXPIRY_CHOICES = [0, 7, 30, 90] as const;

/**
 * Owner/admin team management (Supabase mode). All mutations are enforced
 * server-side by the RPCs; the UI just reflects capability (owner manages
 * roles/removal; owner+admin invite/revoke) and surfaces localized errors.
 */
export function TeamManager({
  locale,
  dict,
  currentUserId,
  currentUserRole,
  initialMembers,
  initialInvites,
}: {
  locale: Locale;
  dict: Dictionary;
  currentUserId: string | null;
  currentUserRole: TenantRole;
  initialMembers: TenantMember[];
  initialInvites: TenantInvite[];
}) {
  const t = dict.access.team;
  const roleLabels = dict.access.session.roles;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("sales_rep");
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageMembers = currentUserRole === "owner";

  function onInvite() {
    // Keep any currently-displayed link until a replacement succeeds (M8E.2).
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createInviteAction({
        email: email.trim(),
        role,
        expiresInDays: expiryDays > 0 ? expiryDays : undefined,
        locale,
      });
      // The action returns the ABSOLUTE canonical URL, built + validated
      // server-side before any mutation (M8E.2); on failure keep any prior link.
      if (result.ok && isDisplayablePublicUrl(result.url)) {
        setCreatedUrl(result.url);
        setEmail("");
        router.refresh();
      } else {
        setError(
          result.reason === "config" ? dict.common.linkUrlError : t.error,
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

  function onRevoke(inviteId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeInviteAction({ inviteId, locale });
      if (!result.ok) setError(t.revokeError);
      router.refresh();
    });
  }

  function onChangeRole(userId: string, newRole: string) {
    if (newRole !== "admin" && newRole !== "sales_rep") return;
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction({ userId, role: newRole, locale });
      if (!result.ok) setError(t.roleError);
      router.refresh();
    });
  }

  function onRemove(userId: string) {
    if (!window.confirm(t.confirmRemove)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction({ userId, locale });
      if (!result.ok) setError(t.removeError);
      router.refresh();
    });
  }

  function onPromoteOwner(userId: string) {
    if (!window.confirm(t.confirmPromote)) return;
    setError(null);
    startTransition(async () => {
      const result = await promoteOwnerAction({ userId, locale });
      if (!result.ok) setError(t.ownerError);
      router.refresh();
    });
  }

  function onDemoteOwner(userId: string) {
    if (!window.confirm(t.confirmDemote)) return;
    setError(null);
    startTransition(async () => {
      const result = await demoteOwnerAction({ userId, role: "admin", locale });
      if (!result.ok) setError(t.ownerError);
      router.refresh();
    });
  }

  const ownerCount = initialMembers.filter((m) => m.role === "owner").length;

  const statusTone: Record<InviteStatus, "success" | "danger" | "neutral" | "warning"> = {
    pending: "warning",
    accepted: "success",
    revoked: "danger",
    expired: "neutral",
  };
  const statusLabel: Record<InviteStatus, string> = {
    pending: t.statusPending,
    accepted: t.statusAccepted,
    revoked: t.statusRevoked,
    expired: t.statusExpired,
  };

  function expiryOptionLabel(days: number): string {
    return days === 0 ? t.expiryNever : t.expiryDays.replace("{count}", String(days));
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p
          role="alert"
          className="rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {/* Invite panel (owner + admin) — band surface, amber submit. */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 bg-band p-5 sm:flex-row sm:items-end sm:p-6">
          <div className="flex-1">
            <label
              htmlFor="invite-email"
              className="mb-1.5 block text-[13px] font-semibold text-band-muted"
            >
              {t.inviteEmail}
            </label>
            <input
              id="invite-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.inviteEmailPlaceholder}
              maxLength={254}
              className="h-11 w-full rounded-field border border-band-muted/35 bg-band-ink/[.07] px-3.5 font-mono text-[13px] text-band-ink placeholder:text-band-muted/70 transition-colors focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/25"
            />
          </div>
          <div className="sm:w-40">
            <label
              htmlFor="invite-role"
              className="mb-1.5 block text-[13px] font-semibold text-band-muted"
            >
              {t.inviteRole}
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}
              className="h-11 w-full rounded-field border border-band-muted/35 bg-band-ink/[.07] px-3.5 text-sm text-band-ink transition-colors focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/25"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r} className="text-ink">
                  {roleLabels[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:w-40">
            <label
              htmlFor="invite-expiry"
              className="mb-1.5 block text-[13px] font-semibold text-band-muted"
            >
              {t.expiry}
            </label>
            <select
              id="invite-expiry"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="h-11 w-full rounded-field border border-band-muted/35 bg-band-ink/[.07] px-3.5 text-sm text-band-ink transition-colors focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/25"
            >
              {EXPIRY_CHOICES.map((d) => (
                <option key={d} value={d} className="text-ink">
                  {expiryOptionLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onInvite}
            disabled={pending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-field bg-accent px-4 text-sm font-extrabold text-band transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            <UserPlus className="size-4" aria-hidden />
            {pending ? t.sending : t.sendInvite}
          </button>
        </div>
      </Card>

      {/* Copy-once invite banner */}
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

      {/* Members */}
      <Card className="overflow-hidden">
        <CardHeader variant="strip">
          <CardTitle>{t.membersTitle}</CardTitle>
        </CardHeader>
        {initialMembers.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={<Users />} title={t.noMembers} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-4 py-3 text-start">{t.colEmail}</th>
                  <th className="px-4 py-3 text-start">{t.colRole}</th>
                  <th className="px-4 py-3 text-start">{t.colJoined}</th>
                  <th className="px-4 py-3 text-end">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {initialMembers.map((m) => {
                  const isSelf = m.userId === currentUserId;
                  const isOwner = m.role === "owner";
                  const editable = canManageMembers && !isSelf && !isOwner;
                  const initial = m.email.trim().charAt(0).toUpperCase() || "?";
                  return (
                    <tr
                      key={m.userId}
                      className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-field text-[13px] font-extrabold",
                              isOwner
                                ? "bg-band text-accent"
                                : "bg-surface-sunken text-ink-soft",
                            )}
                          >
                            {initial}
                          </span>
                          <span
                            className="font-mono text-[13px] font-medium text-ink"
                            dir="ltr"
                          >
                            {m.email}
                          </span>
                          {isSelf ? (
                            <Badge tone="brand" dir="auto">{t.you}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {editable ? (
                          <Select
                            aria-label={t.changeRole}
                            value={m.role}
                            onChange={(e) => onChangeRole(m.userId, e.target.value)}
                            disabled={pending}
                            className="h-9 w-36"
                          >
                            {INVITE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabels[r]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Badge tone={isOwner ? "brand" : "neutral"} dot>
                            {roleLabels[m.role]}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-ink-muted">
                        {formatDate(m.createdAt, locale)}
                      </td>
                      <td className="px-4 py-3.5 text-end">
                        {canManageMembers ? (
                          <div className="flex items-center justify-end gap-1.5">
                            {isOwner ? (
                              <button
                                type="button"
                                onClick={() => onDemoteOwner(m.userId)}
                                disabled={pending || ownerCount <= 1}
                                title={ownerCount <= 1 ? t.lastOwnerNote : t.demoteOwner}
                                className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40"
                              >
                                <ShieldMinus className="size-3.5" aria-hidden />
                                {t.demoteOwner}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onPromoteOwner(m.userId)}
                                  disabled={pending}
                                  title={t.promoteOwner}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
                                >
                                  <ShieldPlus className="size-3.5" aria-hidden />
                                  {t.promoteOwner}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRemove(m.userId)}
                                  disabled={pending}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
                                >
                                  <Trash2 className="size-3.5" aria-hidden />
                                  {t.remove}
                                </button>
                              </>
                            )}
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
        {canManageMembers ? (
          <p className="border-t border-line bg-surface-warm px-5 py-3 text-xs text-ink-soft">
            {t.lastOwnerNote}
          </p>
        ) : null}
      </Card>

      {/* Invitations */}
      <Card className="overflow-hidden">
        <CardHeader variant="strip">
          <CardTitle>{t.invitesTitle}</CardTitle>
        </CardHeader>
        {initialInvites.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={<Mail />} title={t.noInvites} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-warm text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-4 py-3 text-start">{t.colEmail}</th>
                  <th className="px-4 py-3 text-start">{t.colRole}</th>
                  <th className="px-4 py-3 text-start">{t.colStatus}</th>
                  <th className="px-4 py-3 text-start">{t.colExpires}</th>
                  <th className="px-4 py-3 text-end">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {initialInvites.map((inv) => {
                  const initial = inv.email.trim().charAt(0).toUpperCase() || "?";
                  return (
                  <tr
                    key={inv.id}
                    className="border-b border-line-hair transition-colors last:border-0 hover:bg-surface-warm"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-sunken text-[13px] font-extrabold text-ink-soft"
                        >
                          {initial}
                        </span>
                        <span
                          className="font-mono text-[13px] font-medium text-ink"
                          dir="ltr"
                        >
                          {inv.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge tone="neutral" dot>{roleLabels[inv.role]}</Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge tone={statusTone[inv.status]} dot>
                        {statusLabel[inv.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-ink-muted">
                      {inv.expiresAt ? formatDate(inv.expiresAt, locale) : t.never}
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      {inv.status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => onRevoke(inv.id)}
                          disabled={pending}
                          className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          {t.revoke}
                        </button>
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
      </Card>
    </div>
  );
}
