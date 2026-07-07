-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6E.1 — harden the sandbox_issue_legal_document RPC BOUNDARY
--
-- Append-only follow-up to M6E (does NOT edit the M6E migration). The RPC is
-- EXECUTE-granted to authenticated, so a direct owner/admin Data-API call must
-- not be able to bypass the app helper. Review found three gaps; all are fixed
-- inside the SQL function itself:
--
--   1) Tenant tax readiness was only checked in the app. Now the RPC REQUIRES a
--      tenant_tax_settings row with legal_invoicing_ready = true (else MDF73,
--      no rows, no numbering).
--   2) The RPC persisted CALLER-SUPPLIED request/response JSON, so a caller
--      could store raw secrets. FIXED by removing the jsonb (and notice / mock
--      / provider_ref) parameters entirely — the RPC now GENERATES minimal,
--      safe, redacted-by-construction sandbox payloads in SQL. The idempotency
--      key is HASHED (never stored raw).
--   3) The RPC did not require the M6C numbering draw. Now it CALLS
--      draw_legal_document_number itself (after auth + readiness + provider
--      mode + idempotency claim), so the DB kill switch being OFF fails the
--      whole call, and a duplicate idempotency key fails BEFORE any draw.
--
-- The old vulnerable overload is DROPPED so it can no longer be executed.
-- Everything remains SANDBOX-ONLY / NON-LEGAL: sandbox=true,
-- legal_effective=false (hard CHECK), provider_mode='sandbox', draft_internal,
-- NULL legal_number/allocation_number, no issued/provider_approved status, no
-- provider/tax-authority call, no PDF, no payment.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Remove the OLD, JSON-accepting overload (must not stay executable) ──
drop function if exists public.sandbox_issue_legal_document(
  uuid, public.legal_document_type, text, text, text, text, jsonb, jsonb, uuid, text);

-- ── 2. Hardened RPC — no caller JSON; all write gates enforced in SQL ─────
create or replace function public.sandbox_issue_legal_document(
  p_tenant_id uuid,
  p_document_type public.legal_document_type,
  p_idempotency_key text,
  p_order_id uuid default null,
  p_provider_mode text default 'sandbox'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_key_hash text;
  v_number text;
  v_alloc text;
  v_ref text;
  v_notice constant text :=
    'SANDBOX / NON-LEGAL SIMULATION — not a legal tax invoice, not a real ' ||
    'allocation number (מספר הקצאה); no tax authority or provider was contacted.';
  v_short_notice constant text := 'SANDBOX / MOCK — not a legal tax invoice';
  v_doc uuid;
  v_req uuid;
  v_req_payload jsonb;
  v_res_payload jsonb;
begin
  -- (1) Role/tenant gate FIRST: owner/admin of the NAMED tenant only.
  --     sales_rep / anon / non-member / cross-tenant → 42501.
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- (2) Sandbox-only provider mode. Reject production/live/shaam/unknown.
  if p_provider_mode is distinct from 'sandbox' then
    raise exception
      'sandbox_issue_legal_document: only provider_mode = sandbox is allowed (no production)'
      using errcode = 'MDF72';
  end if;

  -- (3) Idempotency key sanity (hashed below; never stored raw).
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'sandbox_issue_legal_document: a valid idempotency key is required'
      using errcode = '22023';
  end if;
  v_key_hash := encode(sha256(convert_to(btrim(p_idempotency_key), 'UTF8')), 'hex');

  -- (4) Tenant tax READINESS — enforced in the DB (not just the app). Requires
  --     a tenant_tax_settings row with legal_invoicing_ready = true. No side
  --     effects on failure. (Readiness is necessary, NOT sufficient — the flags
  --     + DB kill switch still gate everything.)
  if not exists (
    select 1 from public.tenant_tax_settings s
    where s.tenant_id = v_tenant and s.legal_invoicing_ready = true
  ) then
    raise exception
      'sandbox_issue_legal_document: tenant tax settings not ready (missing row or legal_invoicing_ready = false)'
      using errcode = 'MDF73';
  end if;

  -- (5) Early kill-switch check for a clean error (the draw below re-enforces
  --     it authoritatively). Off by default → nothing happens.
  if not public._legal_numbering_enabled() then
    raise exception
      'sandbox_issue_legal_document: sandbox legal orchestration is disabled (DB kill switch off)'
      using errcode = 'MDF70';
  end if;

  -- (6) Idempotency CLAIM (unique on the key hash) BEFORE any draw, so a
  --     duplicate fails without drawing/incrementing. Race-safe via the unique
  --     index. legal_document_id is filled in after the document is created.
  begin
    insert into public.tax_authority_requests
      (tenant_id, legal_document_id, kind, idempotency_key, request_payload,
       provider_mode, sandbox)
    values
      (v_tenant, null, 'issue', v_key_hash, '{}'::jsonb, 'sandbox', true)
    returning id into v_req;
  exception when unique_violation then
    raise exception 'sandbox_issue_legal_document: idempotency key already used'
      using errcode = 'MDF71';
  end;

  -- (7) M6C numbering draw — INSIDE the RPC (not the app). Fails (MDF60) if the
  --     DB kill switch is off, rolling the whole call back (claim included).
  --     Increments exactly one legal_invoice_sequences row on success. The
  --     internal preview number is NEVER stored as an official legal_number.
  v_number := public.draw_legal_document_number(v_tenant, p_document_type);

  -- Deterministic, obviously-fake sandbox placeholders generated in SQL (no
  -- caller input, no real values).
  v_alloc := 'SANDBOX-DO-NOT-USE-' ||
    upper(substring(encode(sha256(convert_to(v_key_hash || ':alloc', 'UTF8')), 'hex') from 1 for 12));
  v_ref := 'SANDBOX-REF-' ||
    upper(substring(encode(sha256(convert_to(v_key_hash || ':ref', 'UTF8')), 'hex') from 1 for 12));

  -- (8) The sandbox document: draft_internal + sandbox=true + legal_effective
  --     false. legal_number / allocation_number stay NULL (M6B checks + draft).
  insert into public.legal_documents
    (tenant_id, order_id, document_type, status, sandbox, legal_effective,
     provider_mode, non_legal_notice)
  values
    (v_tenant, p_order_id, p_document_type, 'draft_internal', true, false,
     'sandbox', v_notice)
  returning id into v_doc;

  -- (9) SQL-generated, minimal, safe payloads (no caller JSON; no secrets).
  v_req_payload := jsonb_build_object(
    'sandbox', true, 'legal', false, 'providerMode', 'sandbox',
    'documentType', p_document_type::text,
    'idempotencyKeyHash', v_key_hash,
    'internalPreviewNumber', v_number,
    'notice', v_short_notice);
  v_res_payload := jsonb_build_object(
    'sandbox', true, 'legal', false, 'providerMode', 'sandbox',
    'outcome', 'approved',
    'mockAllocationNumber', v_alloc, 'providerRef', v_ref,
    'internalPreviewNumber', v_number,
    'notice', v_short_notice);

  -- Attach the document + the safe request payload to the claimed request row.
  update public.tax_authority_requests
     set legal_document_id = v_doc, request_payload = v_req_payload
   where id = v_req;

  -- (10) Redacted-by-construction response log (sandbox; legal_effective=false).
  insert into public.tax_authority_responses
    (tenant_id, request_id, http_status, response_payload, allocation_number,
     provider_ref, outcome, sandbox, legal_effective)
  values
    (v_tenant, v_req, 200, v_res_payload, v_alloc, v_ref, 'approved', true, false);

  return jsonb_build_object(
    'ok', true, 'sandbox', true, 'legal', false,
    'legalDocumentId', v_doc, 'status', 'draft_internal',
    'providerMode', 'sandbox', 'internalPreviewNumber', v_number,
    'mockAllocationNumber', v_alloc, 'providerRef', v_ref,
    'notice', v_notice);
end;
$$;

comment on function public.sandbox_issue_legal_document(uuid, public.legal_document_type, text, uuid, text) is
  'M6E.1 (SANDBOX-ONLY, DISABLED by default): hardened. All write gates enforced IN THE RPC (executable by authenticated): authorize_tenant(owner/admin); tenant_tax_settings.legal_invoicing_ready=true (MDF73); provider_mode=sandbox only (MDF72); idempotency claim before draw (MDF71); the M6C draw_legal_document_number is called INSIDE the RPC so the DB kill switch off (MDF60/MDF70) fails the whole call and duplicates never increment. Persists NO caller JSON — payloads are SQL-generated, minimal, sandbox-marked; the idempotency key is hashed, never stored raw. Writes ONLY a draft_internal sandbox row (legal_number/allocation_number stay NULL) + a redacted request/response log pair (sandbox=true, legal_effective=false). Issues NOTHING real.';

revoke all on function public.sandbox_issue_legal_document(uuid, public.legal_document_type, text, uuid, text) from public, anon;
grant execute on function public.sandbox_issue_legal_document(uuid, public.legal_document_type, text, uuid, text) to authenticated, service_role;
