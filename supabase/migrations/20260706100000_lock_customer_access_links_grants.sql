-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M4A.1 — lock customer_access_links table grants
--
-- Codex review of M4A: the M4A migration (20260705170000) granted a
-- column-scoped SELECT to `authenticated` on the NEW customer_access_links
-- table but never stripped the privileges Supabase's default ACL hands new
-- tables. A local probe confirmed BOTH `anon` and `authenticated` still
-- held TRUNCATE, REFERENCES and TRIGGER on the table. TRUNCATE is
-- RLS-EXEMPT, so an anon or authenticated API caller could
--   truncate public.customer_access_links;
-- and wipe every tenant's private shop links.
--
-- The blanket `revoke truncate, references, trigger, maintain on all tables
-- in schema public` in M3A.1 (20260705140000) ran BEFORE this table
-- existed, so it never covered it. This migration applies the same lockdown
-- to customer_access_links only:
--   1. strip ALL privileges from anon + authenticated,
--   2. explicitly strip the RLS-exempt / non-API privileges (TRUNCATE,
--      REFERENCES, TRIGGER, MAINTAIN) for good measure,
--   3. re-grant EXACTLY the intended column-scoped SELECT to authenticated
--      (never token_hash — its exposure would hand a member a would-be
--      credential; the member SELECT hashing already neutralises replay,
--      this keeps the column itself unreadable).
--
-- RLS (members read only their tenant's rows), the SECURITY DEFINER token
-- RPCs, and the service_role grants are all UNTOUCHED. Links are still
-- created/revoked ONLY through insert_customer_access_link /
-- revoke_customer_access_link; anon still reaches the table ONLY through the
-- token functions. No direct anon table access, no public catalog.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Clear everything the default ACL / M4A grant left on the API roles.
revoke all on public.customer_access_links from anon, authenticated;

-- 2. Be explicit about the dangerous privileges (defense in depth and to
--    document intent; `revoke all` above already covers them). MAINTAIN is
--    PostgreSQL 17+, matching M3A.1 which strips it the same way.
revoke truncate, references, trigger, maintain
  on public.customer_access_links
  from anon, authenticated;

-- 3. Re-grant ONLY the columns the admin UI reads — never token_hash. No
--    INSERT/UPDATE/DELETE: links are written EXCLUSIVELY by the RPCs. anon
--    gets nothing (token lookups are SECURITY DEFINER only).
grant select (
  id, tenant_id, customer_id, token_preview, label,
  expires_at, revoked_at, last_used_at, created_by, created_at, updated_at
) on public.customer_access_links to authenticated;

comment on table public.customer_access_links is
  'Tokenized private shop links. Only token_hash is stored, and it is NOT column-readable by members. Members read their own tenant''s links via a column-scoped SELECT + RLS; writes go EXCLUSIVELY through insert_customer_access_link / revoke_customer_access_link; anon resolves/reads/orders ONLY through the SECURITY DEFINER token functions. No anon table access; no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for API roles (locked in M4A.1).';
