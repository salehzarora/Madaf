-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M5A — order-document generation (order request / delivery note /
-- invoice DRAFT)
--
-- Documents were seed-only until now (no create path). M5A adds the first
-- write path: a single SECURITY DEFINER RPC that RECORDS an order-derived
-- document row. Server-side PDF rendering happens in the app
-- (src/lib/pdf) from the same order snapshots — this RPC only persists the
-- metadata row.
--
-- ⚠️ LEGAL (docs/DOCUMENTS_AND_INVOICES_GUIDE.md): Madaf does NOT issue
-- legal tax invoices in this phase. invoice_draft is a DRAFT PREVIEW only:
--   • status is forced to 'draft' — never 'generated' (the CHECK
--     documents_invoice_draft_never_generated already blocks it even for
--     the service role; we never even try),
--   • a non-blank legal_notice is GUARANTEED (CHECK
--     documents_invoice_draft_needs_notice),
--   • document_number is an INTERNAL number (DOC-<orderSerial>-<suffix>),
--     NOT a legal/immutable per-entity tax sequence. Real numbering, a
--     certified provider integration and signed archival are M5B/M6.
--
-- Access model (preserves M4D/M4D.1): authorize_tenant verifies the
-- caller-named tenant against membership (owner/admin/sales_rep may
-- generate) and can_access_order scopes it further — a sales_rep may
-- generate a document ONLY for an assigned-customer order; a null-customer
-- (walk-in) order is owner/admin only; a non-member gets nothing.
--
-- No table grants/policies change: documents stay READ-ONLY for every
-- authenticated client (no direct INSERT/UPDATE/DELETE). Writes go
-- EXCLUSIVELY through this definer RPC, exactly like orders/catalog.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.create_order_document(
  p_tenant_id uuid,
  p_order_id uuid,
  p_document_type public.document_type,
  p_document_locale public.locale_code default 'he',
  p_legal_notice text default null
)
-- Returns the recorded documents row (all columns are non-sensitive).
returns setof public.documents
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_order  public.orders%rowtype;
  v_suffix text;
  v_number text;
  v_notice text;
  v_totals jsonb;
begin
  -- Membership + role: owner/admin/sales_rep may generate documents. Never
  -- trusts a client-supplied tenant_id — the named tenant must be one of the
  -- caller's memberships with an allowed role (else 42501).
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin', 'sales_rep']::public.tenant_role[]);

  -- Order-level scope (M4D.1): owner/admin → any order in the tenant;
  -- sales_rep → only orders whose customer is assigned to them; a
  -- null-customer (walk-in) order is owner/admin only.
  if not public.can_access_order(v_tenant, p_order_id) then
    raise exception 'create_order_document: order % not accessible', p_order_id
      using errcode = 'MDF20'; -- not accessible
  end if;

  -- Load the order. owner/admin short-circuit can_access_order on role
  -- WITHOUT checking existence, so verify the row really is in this tenant.
  select o.* into v_order
  from public.orders o
  where o.tenant_id = v_tenant and o.id = p_order_id;
  if not found then
    raise exception 'create_order_document: order % not found in tenant', p_order_id
      using errcode = 'MDF21'; -- unknown order
  end if;

  -- Internal (NOT legal) document number: DOC-<orderSerial>-<O|D|I>. Mirrors
  -- the seed/mock derivation; unique per tenant via (tenant_id, document_number).
  v_suffix := case p_document_type
    when 'order_request' then 'O'
    when 'delivery_note' then 'D'
    when 'invoice_draft' then 'I'
  end;
  v_number := 'DOC-' || replace(v_order.order_number, 'MDF-', '') || '-' || v_suffix;

  -- An invoice_draft MUST carry a non-blank legal notice. Use the caller's
  -- localized docs.notLegalNotice wording, else fall back to a fixed Hebrew
  -- notice so a draft can never exist without one.
  if p_document_type = 'invoice_draft' then
    v_notice := coalesce(
      nullif(btrim(p_legal_notice), ''),
      'אינה חשבונית מס כחוק. זוהי טיוטה לתצוגה בלבד — מסמך כחוק יופק רק לאחר הגדרת מסים וחיבור ספק הפקת חשבוניות.');
  else
    v_notice := coalesce(p_legal_notice, '');
  end if;

  -- Totals come from the ORDER row (server-computed at order time), never
  -- from the caller. Same canonical shape the seed uses.
  v_totals := jsonb_build_object(
    'subtotal', v_order.subtotal,
    'vat_total', v_order.vat_total,
    'total', v_order.total,
    'currency', v_order.currency,
    'vat_rate', 0.18,
    'vat_is_estimate', true);

  -- Idempotent: one row per (order, type). status stays 'draft' this phase.
  -- Re-generation refreshes the pinned locale / notice / totals snapshot.
  return query
  with upserted as (
    insert into public.documents as d (
      tenant_id, order_id, document_type, document_number,
      document_locale, status, legal_notice, totals_snapshot)
    values (
      v_tenant, p_order_id, p_document_type, v_number,
      p_document_locale, 'draft', v_notice, v_totals)
    on conflict (tenant_id, document_number) do update
      set document_locale = excluded.document_locale,
          legal_notice    = excluded.legal_notice,
          totals_snapshot = excluded.totals_snapshot
    returning d.*
  )
  select * from upserted;
end;
$$;

comment on function public.create_order_document(uuid, uuid, public.document_type, public.locale_code, text) is
  'M5A: record an order-derived document (order_request/delivery_note/invoice_draft) and return it. SECURITY DEFINER — authorize_tenant (owner/admin/sales_rep) + can_access_order gate (sales_rep only for assigned-customer orders; null-customer orders owner/admin only). Idempotent on (tenant_id, document_number). invoice_draft is a DRAFT PREVIEW only: status is forced to draft (never generated) with a guaranteed non-blank legal_notice; the number is internal, NOT a legal tax sequence. Not a legal tax invoice — see docs/DOCUMENTS_AND_INVOICES_GUIDE.md.';

-- Anon/public may NEVER record documents; authenticated is gated in-function.
revoke all on function public.create_order_document(uuid, uuid, public.document_type, public.locale_code, text) from public, anon;
grant execute on function public.create_order_document(uuid, uuid, public.document_type, public.locale_code, text) to authenticated, service_role;
