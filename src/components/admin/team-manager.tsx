"use client";

import { Check, Copy, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { TenantRole } from "@/lib/auth/session";
import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
  updateMemberRoleAction,
} from "@/lib/actions/team";
import type { InviteStatus, TenantInvite, TenantMember } from "@/lib/data/team";
import { formatDate } from "@/lib/format";

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
    setError(null);
    setCreatedUrl(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createInviteAction({
        email: email.trim(),
        role,
        expiresInDays: expiryDays > 0 ? expiryDays : undefined,
        locale,
      });
      if (result.ok && result.url) {
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        setCreatedUrl(`${origin}${result.url}`);
        setEmail("");
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

      {/* Invite form (owner + admin) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="invite-email">{t.inviteEmail}</Label>
          <Input
            id="invite-email"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.inviteEmailPlaceholder}
            maxLength={254}
          />
        </div>
        <div className="sm:w-40">
          <Label htmlFor="invite-role">{t.inviteRole}</Label>
          <Select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:w-40">
          <Label htmlFor="invite-expiry">{t.expiry}</Label>
          <Select
            id="invite-expiry"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
          >
            {EXPIRY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {expiryOptionLabel(d)}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={onInvite} disabled={pending} className="sm:w-auto">
          <UserPlus className="size-4" aria-hidden />
          {pending ? t.sending : t.sendInvite}
        </Button>
      </div>

      {/* Copy-once invite banner */}
      {createdUrl ? (
        <div className="rounded-card border border-success/30 bg-success-soft p-4">
          <p className="text-sm font-semibold text-success">{t.createdTitle}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{t.createdHint}</p>
          <div className="mt-3 flex items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-field border border-line bg-surface px-3 py-2 text-xs text-ink"
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
      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">{t.membersTitle}</h2>
        {initialMembers.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
            {t.noMembers}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5 text-start font-medium">{t.colEmail}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t.colRole}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t.colJoined}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {initialMembers.map((m) => {
                  const isSelf = m.userId === currentUserId;
                  const isOwner = m.role === "owner";
                  const editable = canManageMembers && !isSelf && !isOwner;
                  return (
                    <tr key={m.userId} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-3 font-medium text-ink" dir="ltr">
                        <span className="flex items-center gap-2">
                          {m.email}
                          {isSelf ? (
                            <Badge tone="brand" dir="auto">{t.you}</Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-3">
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
                          <Badge tone={isOwner ? "brand" : "neutral"}>
                            {roleLabels[m.role]}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-muted">
                        {formatDate(m.createdAt, locale)}
                      </td>
                      <td className="px-3 py-3 text-end">
                        {canManageMembers && !isSelf && !isOwner ? (
                          <button
                            type="button"
                            onClick={() => onRemove(m.userId)}
                            disabled={pending}
                            className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {t.remove}
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
        {canManageMembers ? (
          <p className="mt-2 text-xs text-ink-muted">{t.lastOwnerNote}</p>
        ) : null}
      </section>

      {/* Invitations */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">{t.invitesTitle}</h2>
        {initialInvites.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
            {t.noInvites}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5 text-start font-medium">{t.colEmail}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t.colRole}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t.colStatus}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t.colExpires}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {initialInvites.map((inv) => (
                  <tr key={inv.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-3 font-medium text-ink" dir="ltr">
                      {inv.email}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="neutral">{roleLabels[inv.role]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[inv.status]}>
                        {statusLabel[inv.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-ink-muted">
                      {inv.expiresAt ? formatDate(inv.expiresAt, locale) : t.never}
                    </td>
                    <td className="px-3 py-3 text-end">
                      {inv.status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => onRevoke(inv.id)}
                          disabled={pending}
                          className="inline-flex h-9 items-center gap-1.5 rounded-field px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
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
    </div>
  );
}
