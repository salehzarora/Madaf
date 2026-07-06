"use client";

import { Store, UserCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  assignCustomerAction,
  unassignCustomerAction,
} from "@/lib/actions/rep-assignments";
import type { RepAssignment } from "@/lib/data/rep-assignments";

interface RepOption {
  userId: string;
  email: string;
}
interface CustomerOption {
  id: string;
  name: string;
}

/**
 * Owner/admin assign customers to a sales_rep (M4D). A rep with no
 * assignments sees no customers and cannot order for any — assignments here
 * are what open that up. Every mutation is re-verified server-side.
 */
export function RepAssignments({
  locale,
  dict,
  reps,
  customers,
  assignments,
}: {
  locale: Locale;
  dict: Dictionary;
  reps: RepOption[];
  customers: CustomerOption[];
  assignments: RepAssignment[];
}) {
  const t = dict.access.team;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});

  const customerName = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers],
  );
  const byRep = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of assignments) {
      const list = map.get(a.userId) ?? [];
      list.push(a.customerId);
      map.set(a.userId, list);
    }
    return map;
  }, [assignments]);

  function onAssign(userId: string) {
    const customerId = picks[userId];
    if (!customerId) return;
    setError(false);
    startTransition(async () => {
      const result = await assignCustomerAction({ userId, customerId, locale });
      if (!result.ok) setError(true);
      setPicks((p) => ({ ...p, [userId]: "" }));
      router.refresh();
    });
  }

  function onUnassign(userId: string, customerId: string) {
    setError(false);
    startTransition(async () => {
      const result = await unassignCustomerAction({
        userId,
        customerId,
        locale,
      });
      if (!result.ok) setError(true);
      router.refresh();
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <UserCog className="size-5 text-ink-muted" aria-hidden />
          {t.assignmentsTitle}
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">{t.assignmentsSubtitle}</p>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {t.assignError}
        </p>
      ) : null}

      {reps.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          {t.noReps}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {reps.map((rep) => {
            const assigned = byRep.get(rep.userId) ?? [];
            const assignedSet = new Set(assigned);
            const available = customers.filter((c) => !assignedSet.has(c.id));
            return (
              <div
                key={rep.userId}
                className="rounded-card border border-line p-3 sm:p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-ink" dir="ltr">
                    {rep.email}
                  </p>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {t.assignedCount.replace("{count}", String(assigned.length))}
                  </span>
                </div>

                {assigned.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {assigned.map((cid) => (
                      <span
                        key={cid}
                        className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-soft"
                      >
                        <Store className="size-3" aria-hidden />
                        {customerName.get(cid) ?? cid}
                        <button
                          type="button"
                          onClick={() => onUnassign(rep.userId, cid)}
                          disabled={pending}
                          aria-label={t.unassign}
                          title={t.unassign}
                          className="ms-0.5 rounded-full text-ink-muted transition-colors hover:text-danger disabled:opacity-50"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-muted">{t.noAssignments}</p>
                )}

                {available.length > 0 ? (
                  <div className="mt-3 flex items-end gap-2">
                    <Select
                      aria-label={t.assignCustomer}
                      value={picks[rep.userId] ?? ""}
                      onChange={(e) =>
                        setPicks((p) => ({ ...p, [rep.userId]: e.target.value }))
                      }
                      className="h-9 flex-1"
                    >
                      <option value="">{t.assignCustomer}…</option>
                      {available.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAssign(rep.userId)}
                      disabled={pending || !picks[rep.userId]}
                    >
                      {t.assign}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
