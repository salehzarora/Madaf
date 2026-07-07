-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6C — legal numbering SKELETON (DISABLED by default)
--
-- ⚠️⚠️ STILL NO LEGAL TAX INVOICE IS ISSUED. ⚠️⚠️
-- M6C adds ONE low-level primitive: a SECURITY DEFINER RPC that atomically
-- draws the next INTERNAL, NON-LEGAL preview number from the M6B
-- `legal_invoice_sequences` counters. It is INERT by default and does NOT:
--   • issue a legal tax invoice, • request/verify an allocation number
--     (מספר הקצאה), • call any tax authority / provider, • add payments,
--   • create a legal PDF, • attach a legal_number to `legal_documents`,
--   • set any `issued`/provider status, • get called by any UI or route.
--
-- TWO fail-closed gates, both default OFF (defense in depth):
--   1. A DB kill switch `legal_numbering_settings.enabled` (default FALSE,
--      service-role-only — a normal client can neither read nor flip it). The
--      draw RPC refuses unless it is on, so even a direct owner/admin call via
--      the Data API draws NOTHING in M6C. Flipping it on is a FUTURE
--      (M6D/M6E) trusted-server act.
--   2. The server-only env flag `MADAF_LEGAL_NUMBERING_ENABLED` (default off)
--      gates the FUTURE app-layer helper (src/lib/data/legal-numbering.ts),
--      which is dormant — wired to nothing in M6C.
--
-- The drawn string is an internal preview like `DRAFT-LEGAL-2026-000001` — it
-- is NOT a legal/official numbering sequence and claims no compliance. Real
-- numbering (correct format, gap policy, per-entity/year scoping verified
-- against official Israel Tax Authority rules) + provider clearance + issuing
-- are M6D-M6G, behind flags, after a professional tax/accounting/legal review.
-- See docs/LEGAL_INVOICING_ARCHITECTURE.md.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. DB kill switch — single-row, DEFAULT DISABLED, service-role only ───
create table public.legal_numbering_settings (
  id integer primary key default 1,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint legal_numbering_settings_singleton check (id = 1)
);

comment on table public.legal_numbering_settings is
  'M6C: single-row DB kill switch for the legal-numbering skeleton. DEFAULT false (fail-closed): draw_legal_document_number refuses unless this is on. Service-role-only — no anon/authenticated read or write; a normal client can neither see nor flip it. Enabling is a FUTURE (M6D/M6E) trusted-server act coupled to MADAF_LEGAL_NUMBERING_ENABLED. Not per-tenant: a platform kill switch (the drawing itself is tenant-scoped via legal_invoice_sequences + authorize_tenant).';

-- Seed the single, DISABLED row.
insert into public.legal_numbering_settings (id, enabled)
values (1, false)
on conflict (id) do nothing;

alter table public.legal_numbering_settings enable row level security;
-- Fully locked, exactly like token_access_attempts: no anon/authenticated
-- grants, no policy; service-role only. RLS-enabled deny-by-default.
revoke all on public.legal_numbering_settings from anon, authenticated;
revoke truncate, references, trigger, maintain
  on public.legal_numbering_settings from anon, authenticated;
grant select, insert, update, delete on public.legal_numbering_settings to service_role;

create trigger legal_numbering_settings_set_updated_at
  before update on public.legal_numbering_settings
  for each row execute function public.set_updated_at();

-- ── 2. _legal_numbering_enabled() — fail-closed reader ───────────────────
-- Returns false if the row is somehow missing (fail closed). Only the draw
-- RPC (SECURITY DEFINER, owned by the same role) needs it; not client-callable.
create or replace function public._legal_numbering_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled from public.legal_numbering_settings s where s.id = 1), false);
$$;

comment on function public._legal_numbering_enabled() is
  'M6C: fail-closed read of the legal-numbering DB kill switch (false if the row is missing). Internal to draw_legal_document_number; service-role only.';

revoke all on function public._legal_numbering_enabled() from public, anon, authenticated;
grant execute on function public._legal_numbering_enabled() to service_role;

-- ── 3. draw_legal_document_number — owner/admin, gated, atomic, INERT ─────
create or replace function public.draw_legal_document_number(
  p_tenant_id uuid,
  p_document_type public.legal_document_type,
  p_year integer default null,
  p_legal_entity_id uuid default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_prefix text;
  v_drawn bigint;
  v_year_label text;
begin
  -- Role/tenant gate FIRST (before the kill switch): owner/admin of the NAMED
  -- tenant only. sales_rep / anon / non-member / cross-tenant → 42501. The
  -- client-supplied tenant_id is never trusted (authorize_tenant verifies it
  -- is one of the caller's own memberships with an allowed role).
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Fail-closed kill switch. ALWAYS off in M6C → no number is ever drawn in
  -- any real path (even a direct owner/admin Data-API call). A normal client
  -- cannot turn it on (service-role-only table).
  if not public._legal_numbering_enabled() then
    raise exception
      'draw_legal_document_number: legal numbering is disabled (M6C skeleton — not active)'
      using errcode = 'MDF60';
  end if;

  -- Ensure the (tenant, entity, type, year) counter exists, then draw
  -- atomically under a row lock so concurrent draws cannot collide or reuse a
  -- number (same pattern as next_order_number). This does NOT touch
  -- legal_documents, assign an allocation number, set an issued status, or
  -- call any provider — it only increments a counter and formats a string.
  insert into public.legal_invoice_sequences
    (tenant_id, legal_entity_id, document_type, year_scope, prefix, next_value)
  values
    (v_tenant, p_legal_entity_id, p_document_type, p_year, 'DRAFT-LEGAL', 1)
  on conflict (tenant_id, legal_entity_id, document_type, year_scope) do nothing;

  update public.legal_invoice_sequences
     set next_value = next_value + 1
   where tenant_id = v_tenant
     and legal_entity_id is not distinct from p_legal_entity_id
     and document_type = p_document_type
     and year_scope is not distinct from p_year
  returning coalesce(nullif(btrim(prefix), ''), 'DRAFT-LEGAL'), next_value - 1
       into v_prefix, v_drawn;

  v_year_label := coalesce(p_year::text, to_char(now(), 'YYYY'));
  -- ⚠️ INTERNAL preview format ONLY — NOT a legal/official tax-invoice number.
  return v_prefix || '-' || v_year_label || '-' || lpad(v_drawn::text, 6, '0');
end;
$$;

comment on function public.draw_legal_document_number(uuid, public.legal_document_type, integer, uuid) is
  'M6C (DISABLED by default): draw the next INTERNAL, NON-LEGAL preview number for a (tenant, legal entity, document type, year) counter in legal_invoice_sequences. SECURITY DEFINER + authorize_tenant(owner/admin) + a fail-closed kill switch (legal_numbering_settings.enabled, default false → refuses in M6C). Atomic row-locked increment; numbers are never reused. Issues NOTHING: no invoice, no legal_number on legal_documents, no issued status, no allocation number, no provider call, no payment, no PDF. Not a legal number. No UI/route calls it in M6C.';

revoke all on function public.draw_legal_document_number(uuid, public.legal_document_type, integer, uuid) from public, anon;
grant execute on function public.draw_legal_document_number(uuid, public.legal_document_type, integer, uuid) to authenticated, service_role;

-- ── 4. Note the M6C usage on the (unchanged) M6B counter table ───────────
comment on table public.legal_invoice_sequences is
  'M6B counters, drawn since M6C ONLY by draw_legal_document_number (DISABLED by default — see legal_numbering_settings). Still service-role-only at the table level (no client write); the SECURITY DEFINER draw RPC is the only writer. Numbers drawn are INTERNAL previews, not legal/official numbering — no invoice is issued.';
