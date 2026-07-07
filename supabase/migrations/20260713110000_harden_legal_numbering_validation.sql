-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6C.1 — harden draw_legal_document_number parameter validation
--
-- Append-only follow-up to M6C (does NOT edit the M6C migration). Fixes two
-- input-validation gaps found in review:
--   1. p_year accepted nonsensical values (e.g. -1 → 'DRAFT-LEGAL--1-000001').
--      Now: NULL defaults to the current UTC calendar year, and the resolved
--      year must fall in the static sane range 2000..2100 (else MDF61).
--   2. p_legal_entity_id accepted any random UUID (no tenant-owned
--      legal_entities table exists yet). Now: a non-null p_legal_entity_id is
--      REJECTED (MDF62) so no arbitrary entity id can be written into
--      legal_invoice_sequences. The column stays nullable for future use.
--
-- Everything else is UNCHANGED and this remains a DISABLED skeleton:
-- SECURITY DEFINER, search_path='', owner/admin via authorize_tenant
-- (sales_rep/anon/non-member/cross-tenant blocked), the fail-closed DB kill
-- switch (default OFF), atomic row-locked draw with no reuse. It issues
-- NOTHING: no invoice, no legal_documents row, no legal_number, no status
-- change, no allocation/provider/payment call, no PDF. No UI/route calls it.
--
-- Check order: role/tenant → legal_entity → year → kill switch → atomic draw.
-- So bad input (MDF61/MDF62) is rejected for an authorized owner/admin
-- regardless of the kill switch, and a VALID call with the switch off still
-- returns MDF60. Any error raised before the UPDATE means NO increment.
--
-- Number format is an INTERNAL preview only (DRAFT-LEGAL-YYYY-######), NOT a
-- legal/official numbering sequence. See docs/LEGAL_INVOICING_ARCHITECTURE.md.
-- ═══════════════════════════════════════════════════════════════════════

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
  v_year integer;
  v_prefix text;
  v_drawn bigint;
begin
  -- 1. Role/tenant gate FIRST: owner/admin of the NAMED tenant only.
  --    sales_rep / anon / non-member / cross-tenant → 42501. Never trusts the
  --    client tenant_id.
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- 2. Legal-entity scoping is NOT implemented yet (no tenant-owned
  --    legal_entities table). Reject any non-null id so no arbitrary UUID is
  --    ever written into legal_invoice_sequences. Column stays nullable for a
  --    future phase.
  if p_legal_entity_id is not null then
    raise exception
      'draw_legal_document_number: legal entity scoping is not implemented yet'
      using errcode = 'MDF62';
  end if;

  -- 3. Year: NULL → current UTC calendar year; the resolved year must be in a
  --    sane static range (2000..2100). Rejects negative, zero, and absurd
  --    years. Static range chosen for simplicity/stability (documented).
  v_year := coalesce(p_year, (extract(year from (now() at time zone 'utc')))::integer);
  if v_year < 2000 or v_year > 2100 then
    raise exception
      'draw_legal_document_number: invalid legal numbering year %', v_year
      using errcode = 'MDF61';
  end if;

  -- 4. Fail-closed kill switch. ALWAYS off in M6C → no number is ever drawn in
  --    any real path (even a direct owner/admin Data-API call). A normal client
  --    cannot turn it on (service-role-only table).
  if not public._legal_numbering_enabled() then
    raise exception
      'draw_legal_document_number: legal numbering is disabled (M6C skeleton — not active)'
      using errcode = 'MDF60';
  end if;

  -- 5. Ensure the (tenant, [null entity], type, year) counter exists, then draw
  --    atomically under a row lock so concurrent draws cannot collide or reuse
  --    a number. legal_entity_id is always NULL here (non-null rejected above).
  --    This does NOT touch legal_documents, assign an allocation number, set an
  --    issued status, or call any provider — it only increments a counter.
  insert into public.legal_invoice_sequences
    (tenant_id, legal_entity_id, document_type, year_scope, prefix, next_value)
  values
    (v_tenant, null, p_document_type, v_year, 'DRAFT-LEGAL', 1)
  on conflict (tenant_id, legal_entity_id, document_type, year_scope) do nothing;

  update public.legal_invoice_sequences
     set next_value = next_value + 1
   where tenant_id = v_tenant
     and legal_entity_id is null
     and document_type = p_document_type
     and year_scope = v_year
  returning coalesce(nullif(btrim(prefix), ''), 'DRAFT-LEGAL'), next_value - 1
       into v_prefix, v_drawn;

  -- ⚠️ INTERNAL preview format ONLY — NOT a legal/official tax-invoice number.
  return v_prefix || '-' || v_year::text || '-' || lpad(v_drawn::text, 6, '0');
end;
$$;

comment on function public.draw_legal_document_number(uuid, public.legal_document_type, integer, uuid) is
  'M6C.1 (DISABLED by default): draw the next INTERNAL, NON-LEGAL preview number (DRAFT-LEGAL-YYYY-######) for a (tenant, document type, year) counter. Validates inputs: legal_entity_id must be NULL (MDF62 — entity scoping not implemented), year defaults to current UTC year and must be 2000..2100 (MDF61). SECURITY DEFINER + authorize_tenant(owner/admin) + fail-closed kill switch (legal_numbering_settings.enabled, default false → MDF60). Atomic row-locked increment; never reused. Issues NOTHING (no invoice, legal_number, issued status, allocation number, provider call, payment, or PDF). Not a legal number. No UI/route calls it.';

-- Re-assert grants (create-or-replace preserves them; explicit for clarity).
revoke all on function public.draw_legal_document_number(uuid, public.legal_document_type, integer, uuid) from public, anon;
grant execute on function public.draw_legal_document_number(uuid, public.legal_document_type, integer, uuid) to authenticated, service_role;
