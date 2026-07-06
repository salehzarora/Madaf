-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M5B — stored document PDFs: private storage + signed access
--
-- M5A generated document PDFs on demand (nothing stored). M5B stores them
-- in a PRIVATE Supabase Storage bucket and serves them via short-lived
-- signed URLs, access-gated exactly like order reads.
--
-- Adds:
--   • storage metadata columns on public.documents (nullable, RPC-written),
--   • a PRIVATE `documents` bucket (never public),
--   • storage.objects policies keyed on the path's tenant + order segments,
--     so SELECT (sign/download) / INSERT / UPDATE all require
--     can_access_order — owner/admin any tenant order, a sales_rep only an
--     assigned-customer order, a walk-in (null-customer) order owner/admin
--     only, non-member/anon nothing,
--   • set_document_storage(): the ONLY writer of the storage columns
--     (documents stay table-level read-only; no direct INSERT/UPDATE grant).
--
-- ⚠️ LEGAL (docs/DOCUMENTS_AND_INVOICES_GUIDE.md): unchanged from M5A —
-- invoice_draft is a DRAFT PREVIEW only. No status change, no numbering, no
-- provider integration, no payments. Path carries NO token_hash / secret /
-- raw token — only tenant_id / order_id / document_type / document_id.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Storage metadata columns (nullable; written ONLY via set_document_storage)
alter table public.documents
  add column storage_path    text,
  add column generated_at    timestamptz,
  add column file_size_bytes integer,
  add column checksum        text;

comment on column public.documents.storage_path is
  'Private-bucket object path of the last-generated PDF (tenant_id/documents/order_id/document_type/…). NULL until first generated. Written only by set_document_storage.';

-- ── Private bucket ─────────────────────────────────────────────────────────
-- PDFs are tenant data — never public. Path convention:
--   documents/<tenant_id>/documents/<order_id>/<document_type>/<document_id>_<locale>.pdf
-- The FIRST folder segment is the tenant uuid and the THIRD is the order
-- uuid — that is what the policies below key on.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,           -- PRIVATE — no public document URLs, ever
  10485760,        -- 10 MiB is ample for an A4 order document
  array['application/pdf']
)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase. Deny by default;
-- every operation on this bucket requires order-level access. A short path
-- (length guard) is simply denied rather than erroring on the uuid cast.

create policy "documents: can_access_order can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and array_length(storage.foldername(name), 1) >= 3
    and public.can_access_order(
      ((storage.foldername(name))[1])::uuid,
      ((storage.foldername(name))[3])::uuid)
  );

create policy "documents: can_access_order can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and array_length(storage.foldername(name), 1) >= 3
    and public.can_access_order(
      ((storage.foldername(name))[1])::uuid,
      ((storage.foldername(name))[3])::uuid)
  );

create policy "documents: can_access_order can replace"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'documents'
    and array_length(storage.foldername(name), 1) >= 3
    and public.can_access_order(
      ((storage.foldername(name))[1])::uuid,
      ((storage.foldername(name))[3])::uuid)
  )
  with check (
    bucket_id = 'documents'
    and array_length(storage.foldername(name), 1) >= 3
    and public.can_access_order(
      ((storage.foldername(name))[1])::uuid,
      ((storage.foldername(name))[3])::uuid)
  );

-- No DELETE policy: documents are voided, never destroyed; the object is
-- overwritten (upsert) on regeneration, not deleted.

-- ── set_document_storage — the ONLY writer of the storage columns ─────────
-- SECURITY DEFINER so it writes past the documents read-only table grant.
-- authorize_tenant + can_access_order gate it (owner/admin any order,
-- sales_rep only assigned-customer orders), and the path is re-checked to
-- be under this tenant's documents/ prefix (defense in depth vs a forged
-- cross-tenant path). Updates ONLY the storage columns — never type /
-- status / legal_notice / number (those stay as create_order_document set
-- them, preserving the legal guardrails).
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
  v_tenant uuid;
  v_order  uuid;
  v_prefix text;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin', 'sales_rep']::public.tenant_role[]);

  select d.order_id into v_order
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

  -- The object MUST live under this tenant's documents/ prefix.
  v_prefix := v_tenant::text || '/documents/';
  if p_storage_path is null or left(p_storage_path, length(v_prefix)) <> v_prefix then
    raise exception 'set_document_storage: path % not under tenant prefix', p_storage_path
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
  'M5B: record the stored-PDF metadata (storage_path/generated_at/file_size_bytes/checksum) of an existing documents row. SECURITY DEFINER — authorize_tenant(owner/admin/sales_rep) + can_access_order; path must be under <tenant>/documents/. Writes ONLY storage columns; never touches type/status/legal_notice/number. The only write path for these columns (documents stay table-level read-only).';

revoke all on function public.set_document_storage(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.set_document_storage(uuid, uuid, text, integer, text) to authenticated, service_role;
