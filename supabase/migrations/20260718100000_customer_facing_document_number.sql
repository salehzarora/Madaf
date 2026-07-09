-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7G — customer-facing document numbers use the PUBLIC order ref
--
-- documents.document_number was derived from the INTERNAL sequential order
-- number: 'DOC-' || replace(order_number,'MDF-','') || '-<O|D|I>'  → e.g.
-- 'DOC-1042-I'. Draft documents (order request / delivery note / invoice
-- DRAFT) are delivered to the customer, so that leaks the internal warehouse
-- sequence. This switches the derivation to the random per-order public_ref
-- (MDF-XXXXXXXX, M7E) → 'DOC-XXXXXXXX-<O|D|I>'. The internal order_number is
-- unchanged and stays admin/warehouse-only.
--
-- Idempotency: document generation is "one row per (order, type)", but the
-- table only had unique (tenant_id, document_number). With the number keyed
-- off order_number that happened to be one row per (order, type); changing
-- the derivation would otherwise let a re-generation of a pre-existing doc
-- INSERT a second row under the new number. So we FIRST add the natural
-- unique (tenant_id, order_id, document_type) — safe because the current
-- deterministic numbering already guarantees at most one row per that key —
-- and move the upsert's ON CONFLICT onto it, so re-generation UPDATES the
-- existing row (refreshing its number too).
--
-- No legal change: documents stay drafts; the invoice_draft notice/watermark
-- and the never-generated / needs-notice CHECKs are untouched. Local stack is
-- the only environment in scope; apply to hosted staging with `supabase db
-- push`.
-- ═══════════════════════════════════════════════════════════════════════

-- Natural idempotency key (safe: numbering is deterministic per order+type,
-- so no existing tenant has two document rows for the same order+type).
alter table public.documents
  add constraint documents_tenant_order_type_key
  unique (tenant_id, order_id, document_type);

create or replace function public.create_order_document(
  p_tenant_id uuid,
  p_order_id uuid,
  p_document_type public.document_type,
  p_document_locale public.locale_code default 'he',
  p_legal_notice text default null
)
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
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin', 'sales_rep']::public.tenant_role[]);

  if not public.can_access_order(v_tenant, p_order_id) then
    raise exception 'create_order_document: order % not accessible', p_order_id
      using errcode = 'MDF20';
  end if;

  select o.* into v_order
  from public.orders o
  where o.tenant_id = v_tenant and o.id = p_order_id;
  if not found then
    raise exception 'create_order_document: order % not found in tenant', p_order_id
      using errcode = 'MDF21';
  end if;

  v_suffix := case p_document_type
    when 'order_request' then 'O'
    when 'delivery_note' then 'D'
    when 'invoice_draft' then 'I'
  end;

  -- Customer-facing (NOT legal) document number derived from the PUBLIC ref
  -- (M7G) — never the internal sequential order_number. public_ref is NOT
  -- NULL and unique per tenant (M7E), so this is deterministic + unique per
  -- (order, type). A defensive coalesce keeps a number even for a legacy row
  -- somehow missing public_ref (should not happen post-M7E backfill).
  v_number := 'DOC-'
    || replace(coalesce(v_order.public_ref, v_order.order_number), 'MDF-', '')
    || '-' || v_suffix;

  if p_document_type = 'invoice_draft' then
    v_notice := coalesce(
      nullif(btrim(p_legal_notice), ''),
      'אינה חשבונית מס כחוק. זוהי טיוטה לתצוגה בלבד — מסמך כחוק יופק רק לאחר הגדרת מסים וחיבור ספק הפקת חשבוניות.');
  else
    v_notice := coalesce(p_legal_notice, '');
  end if;

  v_totals := jsonb_build_object(
    'subtotal', v_order.subtotal,
    'vat_total', v_order.vat_total,
    'total', v_order.total,
    'currency', v_order.currency,
    'vat_rate', 0.18,
    'vat_is_estimate', true);

  -- Idempotent on the NATURAL key (order, type): re-generation updates the
  -- same row (including its number + pinned locale/notice/totals snapshot).
  return query
  with upserted as (
    insert into public.documents as d (
      tenant_id, order_id, document_type, document_number,
      document_locale, status, legal_notice, totals_snapshot)
    values (
      v_tenant, p_order_id, p_document_type, v_number,
      p_document_locale, 'draft', v_notice, v_totals)
    on conflict (tenant_id, order_id, document_type) do update
      set document_number = excluded.document_number,
          document_locale = excluded.document_locale,
          legal_notice    = excluded.legal_notice,
          totals_snapshot = excluded.totals_snapshot
    returning d.*
  )
  select * from upserted;
end;
$$;
