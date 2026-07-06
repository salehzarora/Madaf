-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4D.2 — restrict private-link metadata reads to owner/admin
--
-- Codex review of M4D/M4D.1: `customer_access_links` still used the M4A
-- `is_tenant_member` SELECT policy, so ANY authenticated tenant member —
-- including a sales_rep with zero assignments — could read a link's
-- customer_id / label / token_preview / expiry / revoked / last_used /
-- created_by. token_hash was already hidden (M4A.1 column grant), but this
-- still leaked private-link + customer metadata outside the M4D
-- assigned-customer scope, and the UI already hides link management from
-- sales_rep.
--
-- Fix: private links are an OWNER/ADMIN concern. Replace the member-wide
-- SELECT policy with an owner/admin-only one. Everything else stays as-is:
-- the M4A.1 column-scoped SELECT grant (never token_hash), no write grants,
-- no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for API roles, and the anon token
-- RPCs (SECURITY DEFINER) which bypass RLS and are unaffected.
-- ═══════════════════════════════════════════════════════════════════════

drop policy "customer_access_links: members can read" on public.customer_access_links;

create policy "customer_access_links: owner/admin can read"
  on public.customer_access_links for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

comment on table public.customer_access_links is
  'Tokenized private shop links. Only token_hash is stored, and it is NOT column-readable by members. OWNER/ADMIN only may read/manage links (M4D.2 — a sales_rep sees none, even for assigned customers); writes go EXCLUSIVELY through insert_customer_access_link / revoke_customer_access_link; anon resolves/reads/orders ONLY through the SECURITY DEFINER token functions. No anon table access; no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for API roles.';
