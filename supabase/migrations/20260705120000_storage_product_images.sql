-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M1 — storage: product images
--
-- Bucket: product-images (private).
-- Path convention: product-images/<tenant_id>/<product_id>/<filename>
--   — the FIRST folder segment is always the tenant uuid, which is what
--   the policies below key on.
--
-- The M0 UI renders generated gradient placeholders; real uploads arrive
-- with the product-form write path (M3). Until then this bucket simply
-- exists so products.image_url has somewhere real to point.
--
-- NOTE (hosted Supabase): some hosted projects restrict DDL on
-- storage.objects to the dashboard. This migration targets the LOCAL
-- stack, which is the only environment in scope for M1. Revisit when a
-- real project is provisioned.
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false, -- private: catalog images are tenant data until public share links (M4+)
  5242880, -- 5 MiB per image is plenty for catalog shots
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase. Deny by default:
-- only tenant members can see their images; only owner/admin can write.

create policy "product-images: tenant members can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

create policy "product-images: owners/admins can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and public.has_tenant_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.tenant_role[]
    )
  );

create policy "product-images: owners/admins can replace"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and public.has_tenant_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.tenant_role[]
    )
  )
  with check (
    bucket_id = 'product-images'
    and public.has_tenant_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.tenant_role[]
    )
  );

create policy "product-images: owners/admins can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and public.has_tenant_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.tenant_role[]
    )
  );
