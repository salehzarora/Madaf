-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6E — SANDBOX-ONLY legal document orchestration (NON-LEGAL)
--
-- ⚠️⚠️ STILL NO LEGAL TAX INVOICE IS ISSUED. ⚠️⚠️
-- M6E wires M6B (tax settings) + M6C (numbering skeleton) + M6D (sandbox
-- provider) into a server-side *simulation* that can, ONLY when every gate is
-- explicitly enabled locally, write clearly-marked SANDBOX / NON-LEGAL rows.
-- It does NOT issue a real tax invoice, request/verify a real allocation
-- number (מספר הקצאה), call any tax authority / provider, add production mode,
-- add payments, or generate a legal PDF.
--
-- STRUCTURAL SAFETY (defense in depth — even a direct owner/admin Data-API
-- call cannot create anything legal):
--   • New markers on legal_documents: `sandbox`, `legal_effective`,
--     `non_legal_notice`, `provider_mode`.
--   • HARD CHECK `legal_effective = false` on legal_documents AND
--     tax_authority_responses — it is IMPOSSIBLE to store a legally-effective
--     row in M6E (relax ONLY in a future, reviewed phase — M6G).
--   • provider_mode is limited to sandbox/null; a provider_mode-tagged row
--     MUST be sandbox=true; a sandbox row MUST carry a non_legal_notice.
--   • The writer RPC keeps status = 'draft_internal', so the existing M6B
--     checks force legal_number / allocation_number / issued_at to stay NULL —
--     a sandbox row can never carry a legal/allocation number.
--   • The writer RPC is owner/admin-only (authorize_tenant) and fail-closed
--     behind the M6C DB kill switch (legal_numbering_settings.enabled, default
--     false). The three server-only env flags gate the app layer on top.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Sandbox / non-legal markers on legal_documents ────────────────────
alter table public.legal_documents
  add column sandbox boolean not null default false,
  add column legal_effective boolean not null default false,
  add column non_legal_notice text,
  add column provider_mode text;

comment on column public.legal_documents.legal_effective is
  'M6E: a legally-effective (real) document. HARD-CONSTRAINED to false in M6E — no real legal invoice exists. Relax ONLY in a future reviewed phase (M6G).';
comment on column public.legal_documents.sandbox is
  'M6E: true for a sandbox/non-legal simulation row. Any M6E-created row is sandbox=true.';

alter table public.legal_documents
  -- HARD gate: no legally-effective row can EVER exist in M6E.
  add constraint legal_documents_m6e_never_legal_effective
    check (legal_effective = false),
  -- Only sandbox (or unset) provider mode may be stored — never production.
  add constraint legal_documents_provider_mode_sandbox_only
    check (provider_mode is null or provider_mode = 'sandbox'),
  -- A provider_mode-tagged row must be a sandbox row.
  add constraint legal_documents_provider_mode_requires_sandbox
    check (provider_mode is null or sandbox = true),
  -- A sandbox row must carry a non-blank non-legal notice.
  add constraint legal_documents_sandbox_requires_notice
    check (
      sandbox = false
      or (non_legal_notice is not null and length(btrim(non_legal_notice)) > 0)
    );

-- ── 2. Sandbox markers on the provider log tables ────────────────────────
alter table public.tax_authority_requests
  add column sandbox boolean not null default false;
alter table public.tax_authority_requests
  add constraint tax_authority_requests_provider_mode_safe
    check (provider_mode is null or provider_mode in ('disabled', 'sandbox'));

alter table public.tax_authority_responses
  add column sandbox boolean not null default false,
  add column legal_effective boolean not null default false;
alter table public.tax_authority_responses
  add constraint tax_authority_responses_never_legal_effective
    check (legal_effective = false);

-- ── 3. sandbox_issue_legal_document — the ONLY M6E write path ─────────────
-- SECURITY DEFINER, owner/admin, tenant-scoped, fail-closed behind the M6C DB
-- kill switch. Writes clearly-marked SANDBOX / NON-LEGAL rows only: a
-- draft_internal legal_documents row (sandbox=true, legal_effective=false,
-- provider_mode='sandbox', legal_number/allocation_number NULL) plus a redacted
-- request/response log pair (sandbox=true, legal_effective=false). It issues
-- NOTHING real. Redaction happens in the app (M6D) before the payloads arrive.
create or replace function public.sandbox_issue_legal_document(
  p_tenant_id uuid,
  p_document_type public.legal_document_type,
  p_idempotency_key text,
  p_non_legal_notice text,
  p_provider_ref text default null,
  p_mock_allocation_number text default null,
  p_request_payload jsonb default '{}'::jsonb,
  p_response_payload jsonb default '{}'::jsonb,
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
  v_notice text;
  v_doc uuid;
  v_req uuid;
begin
  -- Role/tenant gate FIRST: owner/admin of the NAMED tenant only.
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Sandbox-only: reject any non-sandbox provider mode outright.
  if p_provider_mode is distinct from 'sandbox' then
    raise exception
      'sandbox_issue_legal_document: only provider_mode = sandbox is allowed (no production)'
      using errcode = 'MDF72';
  end if;

  -- Fail-closed DB kill switch (M6C). Off by default → nothing is written.
  if not public._legal_numbering_enabled() then
    raise exception
      'sandbox_issue_legal_document: sandbox legal orchestration is disabled (DB kill switch off)'
      using errcode = 'MDF70';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'sandbox_issue_legal_document: a valid idempotency key is required'
      using errcode = '22023';
  end if;

  -- Every sandbox row must carry a loud non-legal notice.
  v_notice := coalesce(
    nullif(btrim(p_non_legal_notice), ''),
    'SANDBOX / NON-LEGAL SIMULATION — not a legal tax invoice, not a real ' ||
    'allocation number (מספר הקצאה); no tax authority or provider was contacted.');

  -- (a) The sandbox document: draft_internal + sandbox=true + legal_effective
  -- false. legal_number / allocation_number stay NULL (M6B checks + draft
  -- status). This can never be mistaken for a real legal invoice.
  insert into public.legal_documents
    (tenant_id, order_id, document_type, status, sandbox, legal_effective,
     provider_mode, non_legal_notice)
  values
    (v_tenant, p_order_id, p_document_type, 'draft_internal', true, false,
     'sandbox', v_notice)
  returning id into v_doc;

  -- (b) Redacted request log (idempotency-keyed; sandbox).
  begin
    insert into public.tax_authority_requests
      (tenant_id, legal_document_id, kind, idempotency_key, request_payload,
       provider_mode, sandbox)
    values
      (v_tenant, v_doc, 'issue', p_idempotency_key,
       coalesce(p_request_payload, '{}'::jsonb), 'sandbox', true)
    returning id into v_req;
  exception when unique_violation then
    raise exception 'sandbox_issue_legal_document: idempotency key already used'
      using errcode = 'MDF71';
  end;

  -- (c) Redacted response log (sandbox; legal_effective=false). The mock
  -- allocation is a loud non-legal placeholder (SANDBOX-DO-NOT-USE-…).
  insert into public.tax_authority_responses
    (tenant_id, request_id, http_status, response_payload, allocation_number,
     provider_ref, outcome, sandbox, legal_effective)
  values
    (v_tenant, v_req, 200, coalesce(p_response_payload, '{}'::jsonb),
     p_mock_allocation_number, p_provider_ref, 'approved', true, false);

  return jsonb_build_object(
    'ok', true,
    'sandbox', true,
    'legal', false,
    'legalDocumentId', v_doc,
    'status', 'draft_internal',
    'providerMode', 'sandbox',
    'notice', v_notice);
end;
$$;

comment on function public.sandbox_issue_legal_document(uuid, public.legal_document_type, text, text, text, text, jsonb, jsonb, uuid, text) is
  'M6E (SANDBOX-ONLY, DISABLED by default): write clearly-marked SANDBOX / NON-LEGAL rows (a draft_internal legal_documents row + a redacted request/response log pair). SECURITY DEFINER + authorize_tenant(owner/admin) + fail-closed M6C DB kill switch (MDF70) + sandbox-only provider mode (MDF72). Issues NOTHING real: no tax invoice, no legal_number/allocation_number on legal_documents (draft status + M6B checks keep them NULL), no issued/provider_approved status, no allocation-number request, no provider/tax-authority call, no payment, no PDF. legal_effective is hard-false. Not a legal document.';

revoke all on function public.sandbox_issue_legal_document(uuid, public.legal_document_type, text, text, text, text, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.sandbox_issue_legal_document(uuid, public.legal_document_type, text, text, text, text, jsonb, jsonb, uuid, text) to authenticated, service_role;
