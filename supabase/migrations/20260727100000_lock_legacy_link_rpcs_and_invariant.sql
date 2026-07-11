-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8E.2 (follow-up) — close the legacy link-RPC bypass + one-active
-- invariant
--
-- CONFIRMED DEFECT: after 20260726100000 added the ATOMIC
-- replace_customer_access_link, the older two-step functions were left
-- EXECUTABLE by `authenticated` (and service_role):
--   • insert_customer_access_link      — mints a link with NO revoke of priors
--   • revoke_customer_access_links_for_customer
-- Calling the legacy insert twice creates TWO active links for one customer —
-- the exact "one live link" invariant the atomic RPC exists to guarantee.
--
-- No production TypeScript uses either legacy RPC anymore (the data layer +
-- shop action route through replace_customer_access_link only). So:
--
--   1. REVOKE EXECUTE on both obsolete functions from EVERY role
--      (public, anon, authenticated, service_role). They are kept (not dropped)
--      for migration-history integrity but can no longer be invoked at runtime;
--      the atomic replace_customer_access_link is the sole supported path.
--      service_role is included deliberately — it is not retained merely because
--      it is server-side; nothing uses these two RPCs on any path.
--
--   2. Add a DURABLE database invariant: at most ONE unrevoked link per
--      (tenant_id, customer_id). customer_id is NOT NULL and this table holds
--      ONLY customer shop links (no link-type dimension), so a partial unique
--      index on (tenant_id, customer_id) WHERE revoked_at IS NULL is exact.
--      Even a direct/legacy insert (or a future bug) cannot create a second
--      active link — the DB rejects it (unique_violation). This composes with
--      the atomic RPC's per-customer FOR UPDATE lock (which serializes) as a
--      second, structural line of defense.
--
-- Additive follow-up (NOT an edit to 20260726100000), matching the repo's
-- append-only migration convention (cf. the harden_* follow-ups). Local stack
-- only; apply to hosted staging with `supabase db push`. NOT yet applied to
-- hosted.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Close the authenticated (and every-role) legacy bypass ─────────────
revoke execute on function
  public.insert_customer_access_link(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

revoke execute on function
  public.revoke_customer_access_links_for_customer(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function
  public.insert_customer_access_link(uuid, uuid, text, text, text, timestamptz) is
  'OBSOLETE (M8E.2): non-atomic single insert with no prior-link revoke. EXECUTE revoked from all roles — use replace_customer_access_link. Kept only for migration-history integrity.';

comment on function
  public.revoke_customer_access_links_for_customer(uuid, uuid) is
  'OBSOLETE (M8E.2): standalone bulk revoke, superseded by the atomic revoke+insert in replace_customer_access_link. EXECUTE revoked from all roles.';

-- ── 2. Dedup any pre-existing duplicate ACTIVE links, then add the invariant ─
-- Hosted rows created via the legacy insert may already hold >1 unrevoked link
-- per (tenant_id, customer_id). Before the unique index can be created, collapse
-- each such group to ONE: keep the NEWEST link (by created_at, tie-break id),
-- REVOKE the older duplicates. Rows are revoked, never deleted (history stays),
-- matching M7H.1 "a store keeps exactly one live link". Deterministic + idempotent
-- (no-op when there are no duplicates, as on the local seed).
with ranked as (
  select id,
         row_number() over (
           partition by tenant_id, customer_id
           order by created_at desc, id desc
         ) as rn
  from public.customer_access_links
  where revoked_at is null
)
update public.customer_access_links l
   set revoked_at = now()
  from ranked
 where l.id = ranked.id
   and ranked.rn > 1;

create unique index customer_access_links_one_active_per_customer
  on public.customer_access_links (tenant_id, customer_id)
  where revoked_at is null;

comment on index public.customer_access_links_one_active_per_customer is
  'One-active-link invariant (M8E.2): at most one unrevoked private shop link per (tenant_id, customer_id). Backstops replace_customer_access_link so no path can leave a store with two live links.';
