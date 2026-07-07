-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6F — SANDBOX archival + signing records (NON-LEGAL, tamper-evidence)
--
-- ⚠️⚠️ STILL NO LEGAL TAX INVOICE, SIGNATURE, OR ARCHIVE. ⚠️⚠️
-- M6F adds a write-once, SANDBOX-only archival + signing layer for the M6E
-- sandbox legal_documents. It is a FUTURE-ARCHITECTURE / tamper-evidence
-- placeholder — NOT a real legal archive, NOT a real e-signature, NOT
-- tax-compliant. It does NOT issue a tax invoice, request/verify an allocation
-- number (מספר הקצאה), call any tax authority / provider, add production mode,
-- payments, or a legal PDF. Signatures are obvious placeholders
-- (SANDBOX-SIGNATURE-…), certs are 'SANDBOX-NO-CERT', and legal_effective stays
-- HARD-false.
--
-- STRUCTURAL SAFETY (defense in depth, mirroring M6E/M6E.1):
--   • New markers on archival_records + signing_records: sandbox,
--     legal_effective, non_legal_notice, provider_mode + HARD CHECK
--     legal_effective=false, provider_mode sandbox/null only, sandbox rows
--     require a non-legal notice, and signing algorithm/signature/cert_ref must
--     be SANDBOX-prefixed placeholders.
--   • WRITE-ONCE: unique (tenant_id, legal_document_id) per table + an
--     immutability guard trigger blocking UPDATE/DELETE.
--   • The writer RPC is owner/admin-only (authorize_tenant), fail-closed behind
--     the M6C DB kill switch (MDF70), validates the TARGET is an M6E sandbox /
--     non-legal document, accepts NO caller JSON (canonical payload + SHA-256
--     generated in SQL), hashes the idempotency key, and is write-once.
--   • Grants unchanged: archival_records owner/admin READ only; signing_records
--     service-role only (signature material never reaches a client); no direct
--     authenticated writes; no grant widening.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Sandbox / non-legal markers on archival_records ───────────────────
alter table public.archival_records
  add column sandbox boolean not null default false,
  add column legal_effective boolean not null default false,
  add column non_legal_notice text,
  add column provider_mode text,
  add column content_sha256 text,
  add column idempotency_key text;

alter table public.archival_records
  add constraint archival_records_m6f_never_legal_effective
    check (legal_effective = false),
  add constraint archival_records_provider_mode_sandbox_only
    check (provider_mode is null or provider_mode = 'sandbox'),
  add constraint archival_records_sandbox_requires_notice
    check (sandbox = false
           or (non_legal_notice is not null and length(btrim(non_legal_notice)) > 0)),
  -- WRITE-ONCE: one archival record per (tenant, document).
  add constraint archival_records_one_per_document unique (tenant_id, legal_document_id);

comment on column public.archival_records.legal_effective is
  'M6F: HARD-false. A sandbox archival record is NON-LEGAL tamper-evidence only, never a real legal archive.';

-- ── 2. Sandbox / non-legal markers on signing_records ────────────────────
alter table public.signing_records
  add column sandbox boolean not null default false,
  add column legal_effective boolean not null default false,
  add column non_legal_notice text,
  add column provider_mode text,
  add column idempotency_key text;

alter table public.signing_records
  add constraint signing_records_m6f_never_legal_effective
    check (legal_effective = false),
  add constraint signing_records_provider_mode_sandbox_only
    check (provider_mode is null or provider_mode = 'sandbox'),
  add constraint signing_records_sandbox_requires_notice
    check (sandbox = false
           or (non_legal_notice is not null and length(btrim(non_legal_notice)) > 0)),
  -- The signature material must be an OBVIOUS sandbox placeholder — never real.
  add constraint signing_records_algorithm_sandbox_only
    check (algorithm is null or algorithm like 'SANDBOX%'),
  add constraint signing_records_signature_sandbox_only
    check (signature is null or signature like 'SANDBOX%'),
  add constraint signing_records_cert_ref_sandbox_only
    check (cert_ref is null or cert_ref like 'SANDBOX%'),
  add constraint signing_records_one_per_document unique (tenant_id, legal_document_id);

comment on column public.signing_records.signature is
  'M6F: SANDBOX placeholder only (SANDBOX-SIGNATURE-…). NOT a real digital signature. Enforced by CHECK.';

-- ── 3. Write-once immutability guard (blocks UPDATE/DELETE on both) ───────
create or replace function public._sandbox_writeonce_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    '%: sandbox archival/signing records are write-once (no update or delete)',
    tg_table_name
    using errcode = '42501';
  return null;
end;
$$;

comment on function public._sandbox_writeonce_guard() is
  'M6F: blocks UPDATE/DELETE on archival_records / signing_records (write-once). Fires for all writers, incl. service_role.';

create trigger archival_records_writeonce
  before update or delete on public.archival_records
  for each row execute function public._sandbox_writeonce_guard();
create trigger signing_records_writeonce
  before update or delete on public.signing_records
  for each row execute function public._sandbox_writeonce_guard();

-- ── 4. sandbox_archive_and_sign_legal_document — the ONLY M6F write path ──
-- owner/admin, fail-closed (DB kill switch), validates the TARGET is an M6E
-- sandbox non-legal document, NO caller JSON (canonical payload + hash in SQL),
-- write-once. Issues NOTHING real; creates no PDF; calls no provider.
create or replace function public.sandbox_archive_and_sign_legal_document(
  p_tenant_id uuid,
  p_legal_document_id uuid,
  p_idempotency_key text
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
  v_doc public.legal_documents%rowtype;
  v_notice constant text :=
    'SANDBOX / NON-LEGAL tamper-evidence — not a legal archive, not a real ' ||
    'digital signature, not tax-compliant. Placeholder only.';
  v_canonical jsonb;
  v_content_sha256 text;
  v_sig text;
  v_arch uuid;
  v_sign uuid;
begin
  -- (1) Role/tenant gate: owner/admin of the NAMED tenant only.
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- (2) Fail-closed DB kill switch (M6C). Off by default → nothing happens.
  if not public._legal_numbering_enabled() then
    raise exception
      'sandbox_archive_and_sign_legal_document: sandbox legal orchestration is disabled (DB kill switch off)'
      using errcode = 'MDF70';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'sandbox_archive_and_sign_legal_document: a valid idempotency key is required'
      using errcode = '22023';
  end if;
  v_key_hash := encode(sha256(convert_to(btrim(p_idempotency_key), 'UTF8')), 'hex');

  -- (3) Load + validate the TARGET is an M6E SANDBOX / NON-LEGAL document.
  select * into v_doc
  from public.legal_documents d
  where d.tenant_id = v_tenant and d.id = p_legal_document_id;
  if not found then
    raise exception 'sandbox_archive_and_sign_legal_document: document not found in tenant'
      using errcode = 'MDF75';
  end if;
  if v_doc.sandbox is not true
     or v_doc.legal_effective is not false
     or v_doc.provider_mode is distinct from 'sandbox'
     or v_doc.non_legal_notice is null or length(btrim(v_doc.non_legal_notice)) = 0
     or v_doc.legal_number is not null
     or v_doc.allocation_number is not null
     or v_doc.status in ('issued', 'provider_approved') then
    raise exception
      'sandbox_archive_and_sign_legal_document: target is not a sandbox non-legal document (refusing)'
      using errcode = 'MDF75';
  end if;

  -- (4) WRITE-ONCE pre-check (deterministic error BEFORE any insert). The unique
  --     constraints also make this race-safe.
  if exists (select 1 from public.archival_records a
             where a.tenant_id = v_tenant and a.legal_document_id = p_legal_document_id)
     or exists (select 1 from public.signing_records s
                where s.tenant_id = v_tenant and s.legal_document_id = p_legal_document_id) then
    raise exception 'sandbox_archive_and_sign_legal_document: document already archived/signed'
      using errcode = 'MDF74';
  end if;

  -- (5) Canonical, SQL-generated NON-LEGAL payload (no caller input). jsonb
  --     sorts keys, so its text — and its SHA-256 — are deterministic.
  v_canonical := jsonb_build_object(
    'sandbox', true, 'legal', false, 'legalEffective', false,
    'providerMode', 'sandbox',
    'legalDocumentId', v_doc.id::text,
    'tenantId', v_doc.tenant_id::text,
    'documentType', v_doc.document_type::text,
    'status', v_doc.status::text,
    'createdAt', to_char(v_doc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'notice', 'SANDBOX / MOCK — not a legal tax invoice');
  v_content_sha256 := encode(sha256(convert_to(v_canonical::text, 'UTF8')), 'hex');
  v_sig := 'SANDBOX-SIGNATURE-' || upper(substring(v_content_sha256 from 1 for 24));

  -- (6) Archival record (write-once). Non-legal placeholder URI + 7y retention
  --     (a documented placeholder, NOT a verified legal retention obligation).
  insert into public.archival_records
    (tenant_id, legal_document_id, archive_uri, retention_until, checksum,
     sandbox, legal_effective, non_legal_notice, provider_mode, content_sha256,
     idempotency_key)
  values
    (v_tenant, p_legal_document_id, 'sandbox://non-legal/' || v_doc.id::text,
     (current_date + interval '7 years')::date, v_content_sha256,
     true, false, v_notice, 'sandbox', v_content_sha256, v_key_hash)
  returning id into v_arch;

  -- (7) Signing record (write-once). Placeholder algorithm / signature / cert.
  insert into public.signing_records
    (tenant_id, legal_document_id, algorithm, signature, cert_ref, signed_hash,
     signed_at, sandbox, legal_effective, non_legal_notice, provider_mode,
     idempotency_key)
  values
    (v_tenant, p_legal_document_id, 'SANDBOX-PLACEHOLDER-SHA256', v_sig,
     'SANDBOX-NO-CERT', v_content_sha256, now(),
     true, false, v_notice, 'sandbox', v_key_hash)
  returning id into v_sign;

  return jsonb_build_object(
    'ok', true, 'sandbox', true, 'legal', false, 'legalEffective', false,
    'legalDocumentId', v_doc.id, 'archivalRecordId', v_arch, 'signingRecordId', v_sign,
    'contentSha256', v_content_sha256,
    'signatureAlgorithm', 'SANDBOX-PLACEHOLDER-SHA256',
    'notice', v_notice);
end;
$$;

comment on function public.sandbox_archive_and_sign_legal_document(uuid, uuid, text) is
  'M6F (SANDBOX-ONLY, DISABLED by default): write-once, NON-LEGAL archival + signing records for an M6E sandbox legal_documents row. SECURITY DEFINER + authorize_tenant(owner/admin) + fail-closed DB kill switch (MDF70) + target validation (sandbox=true, legal_effective=false, provider_mode=sandbox, notice present, NULL legal/allocation numbers, not issued/provider_approved; else MDF75) + write-once (MDF74). NO caller JSON — canonical payload + SHA-256 generated in SQL; idempotency key hashed. Signatures are SANDBOX placeholders; NOT a real signature/cert/archive; legal_effective stays false. No PDF, provider, allocation, or payment.';

revoke all on function public.sandbox_archive_and_sign_legal_document(uuid, uuid, text) from public, anon;
grant execute on function public.sandbox_archive_and_sign_legal_document(uuid, uuid, text) to authenticated, service_role;
