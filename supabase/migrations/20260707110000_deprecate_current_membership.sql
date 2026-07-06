-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4C.1 — deprecate the legacy current_membership() helper
--
-- current_membership() (M4A) returns only the caller's FIRST membership
-- (`order by created_at limit 1`). That was fine when a user belonged to a
-- single tenant, but it is MISLEADING now that M4C supports multiple
-- memberships + a membership-verified selected tenant. The app switched to
-- `list_memberships()` (all memberships) + the `madaf_tenant` cookie in M4C,
-- and nothing else references current_membership() — no RLS policy, no other
-- RPC, no app code, no bootstrap.
--
-- Deprecate it SAFELY without dropping the object (dropping could break any
-- out-of-tree dependency and is unnecessary): remove API access and mark it
-- legacy. `db reset` re-applies 20260705170000 (which grants it to
-- authenticated) and then this migration revokes that grant — service_role
-- keeps it for backwards-compatible bootstrap tooling only.
-- ═══════════════════════════════════════════════════════════════════════

revoke execute on function public.current_membership() from authenticated;

comment on function public.current_membership() is
  'DEPRECATED (M4C.1) — legacy single-membership helper: returns only the FIRST membership and is UNSAFE for multi-tenant routing. Do not use. Superseded by list_memberships() + the membership-verified selected-tenant cookie (see docs/AUTH_AND_ACCESS_MODEL.md). No EXECUTE for anon/authenticated; retained for backward compatibility only.';
