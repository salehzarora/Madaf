-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M5B.1 — lock stored-PDF uploads to a trusted server path
--
-- Codex review of M5B: the `documents` bucket allowed AUTHENTICATED
-- INSERT/UPDATE (gated by can_access_order on the path). That let a normal
-- user — e.g. a sales_rep assigned to an order — DIRECTLY upload/overwrite a
-- FORGED PDF at the deterministic route path via the Storage API; the route
-- would then reuse/sign it. And set_document_storage only checked the tenant
-- PREFIX, so a path with a different order/type/document id was accepted.
--
-- M5B.1 makes stored PDFs tamper-resistant:
--   1. DROP the authenticated documents-bucket policies entirely. With no
--      policy, RLS denies every anon/authenticated SELECT/INSERT/UPDATE/
--      DELETE on the bucket — normal users can no longer read, upload, or
--      overwrite objects directly. Only the SERVICE ROLE (which bypasses
--      RLS) can, and it is used ONLY from the server-only document-storage
--      helper AFTER the route has verified order access. The bucket stays
--      PRIVATE (no public policy). product-images policies are untouched.
--   2. set_document_storage now validates the FULL expected path, derived
--      entirely from the document ROW (tenant / order_id / document_type /
--      id / document_locale), rejecting any mismatched order/type/id/tenant/
--      locale, traversal, non-.pdf, or blank path.
--
-- ⚠️ LEGAL unchanged: invoice_draft stays a DRAFT PREVIEW; no numbering, no
-- provider, no payments (docs/DOCUMENTS_AND_INVOICES_GUIDE.md).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Remove the authenticated documents-bucket policies ─────────────────
-- Uploads/replaces/reads of document objects now go EXCLUSIVELY through the
-- trusted server-only service-role client (bypasses RLS). No authenticated
-- policy remains → anon/authenticated get zero direct access. No DELETE
-- policy is (re)created. product-images policies are a different bucket and
-- are NOT touched.
drop policy "documents: can_access_order can read"    on storage.objects;
drop policy "documents: can_access_order can upload"  on storage.objects;
drop policy "documents: can_access_order can replace"  on storage.objects;

-- ── 2. Full expected-path validation in set_document_storage ──────────────
-- Same signature; the body now builds the ONE valid path from the document
-- row and requires an EXACT match. This rejects a path with another tenant /
-- order / document_type / document id / locale, any "../" traversal, a
-- non-.pdf extension, or a blank path — because none of those equal the
-- DB-derived expected value. Still authorize_tenant + can_access_order gated;
-- still writes ONLY the storage columns (documents stay read-only).
create or replace function public.set_document_storage(
  p_tenant_id uuid,
  p_document_id uuid,
  p_storage_path text,
  p_file_size_bytes integer default null,
  p_checksum text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_order    uuid;
  v_type     public.document_type;
  v_locale   public.locale_code;
  v_expected text;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin', 'sales_rep']::public.tenant_role[]);

  select d.order_id, d.document_type, d.document_locale
    into v_order, v_type, v_locale
  from public.documents d
  where d.tenant_id = v_tenant and d.id = p_document_id;
  if not found then
    raise exception 'set_document_storage: unknown document %', p_document_id
      using errcode = 'MDF22';
  end if;

  if not public.can_access_order(v_tenant, v_order) then
    raise exception 'set_document_storage: order not accessible'
      using errcode = 'MDF20';
  end if;

  -- The ONE valid object path, derived entirely from the row (never trusting
  -- the caller's tenant/order/type/id/locale):
  --   <tenant>/documents/<order>/<document_type>/<document_id>_<locale>.pdf
  v_expected := v_tenant::text || '/documents/' || v_order::text || '/'
    || v_type::text || '/' || p_document_id::text || '_' || v_locale::text
    || '.pdf';

  if p_storage_path is null or p_storage_path <> v_expected then
    raise exception 'set_document_storage: path % is not the expected path %',
      p_storage_path, v_expected
      using errcode = 'MDF23';
  end if;

  update public.documents
     set storage_path    = p_storage_path,
         file_size_bytes = p_file_size_bytes,
         checksum        = p_checksum,
         generated_at    = now()
   where tenant_id = v_tenant and id = p_document_id;
end;
$$;

comment on function public.set_document_storage(uuid, uuid, text, integer, text) is
  'M5B/M5B.1: record the stored-PDF metadata of an existing documents row. SECURITY DEFINER — authorize_tenant(owner/admin/sales_rep) + can_access_order. The path MUST exactly equal the DB-derived <tenant>/documents/<order>/<document_type>/<document_id>_<locale>.pdf (rejects any mismatched tenant/order/type/id/locale, traversal, non-.pdf, or blank path). Writes ONLY storage columns; the trusted server-only service-role client performs the actual upload/sign (authenticated users cannot upload directly). documents stay table-level read-only.';

-- Grants unchanged (authenticated + service_role EXECUTE; anon none) — the
-- function is re-created with `create or replace`, which preserves them.
