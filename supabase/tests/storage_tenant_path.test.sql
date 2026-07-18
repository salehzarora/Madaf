-- ═══════════════════════════════════════════════════════════════════════
-- pgTAP — STORAGE TENANT-PATH ISOLATION (product-images, regression)
--
-- Catalog images live at product-images/<tenant_id>/<product_id>/<file>, and
-- the storage.objects policies derive the owning tenant from the FIRST path
-- segment (storage.foldername(name)[1]). This regression locks in the Pilot-
-- critical guarantees:
--   • the bucket is PRIVATE and all four tenant-path policies exist;
--   • the read policy scopes by is_tenant_member on the path tenant, and the
--     write policies gate on has_tenant_role(owner/admin) on the path tenant;
--   • BEHAVIOURALLY, a member sees only images under THEIR tenant's folder and
--     never another tenant's — verified by switching roles over seeded objects.
--
-- Objects are seeded from a privileged role (RLS-bypassing) so the reads below
-- exercise the SELECT policy, not the seed. Run with the local stack up. Rolls back.
-- ═══════════════════════════════════════════════════════════════════════
begin;
select plan(12);

set local request.jwt.claims = '{"role":"service_role"}';

-- ── Fixtures: tenant C (owner) and tenant B (owner) ───────────────────────
insert into auth.users (id) values
  ('c0c00000-0000-4000-8000-000000000001'),  -- ownerC
  ('b0b00000-0000-4000-8000-000000000001');  -- ownerB
insert into public.tenants (id, name_ar, name_he, name_en) values
  ('33333333-3333-4333-8333-333333333333', 'ج', 'ג', 'C'),
  ('22222222-2222-4222-8222-222222222222', 'ب', 'ב', 'B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'c0c00000-0000-4000-8000-000000000001', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'b0b00000-0000-4000-8000-000000000001', 'owner');

-- ── 1. The bucket is private ──────────────────────────────────────────────
select is((select public from storage.buckets where id='product-images'),
  false, 'product-images bucket is PRIVATE');

-- ── 2–5. All four tenant-path policies exist on storage.objects ───────────
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: tenant members can read'),
  'read policy exists');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: owners/admins can upload'),
  'upload policy exists');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: owners/admins can replace'),
  'replace policy exists');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: owners/admins can delete'),
  'delete policy exists');

-- ── 6–7. The read policy derives the tenant from the path + is_tenant_member ─
select ok((select qual from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: tenant members can read') like '%foldername%',
  'read policy derives the tenant from the object path (foldername[1])');
select ok((select qual from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: tenant members can read') like '%is_tenant_member%',
  'read policy scopes to a member of the PATH tenant');

-- ── 8–9. The write policies gate on has_tenant_role(owner/admin) on the path ─
select ok((select with_check from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: owners/admins can upload') like '%has_tenant_role%',
  'upload policy gates writes on has_tenant_role (owner/admin)');
select ok((select with_check from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='product-images: owners/admins can upload') like '%foldername%',
  'upload policy keys the role check on the PATH tenant (foldername[1])');

-- ── Seed one object under each tenant's folder (privileged: bypasses RLS) ──
reset role;
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'product-images',
   '33333333-3333-4333-8333-333333333333/40000000-0000-4000-8000-0000000000c1/img.jpg'),
  (gen_random_uuid(), 'product-images',
   '22222222-2222-4222-8222-222222222222/40000000-0000-4000-8000-0000000000b1/img.jpg');

-- ── 10–11. Member of C sees ONLY C's image ────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from storage.objects
           where bucket_id='product-images'
             and (storage.foldername(name))[1]='33333333-3333-4333-8333-333333333333'),
  1::bigint, 'a member of C sees C''s own catalog image');
select is((select count(*) from storage.objects
           where bucket_id='product-images'
             and (storage.foldername(name))[1]='22222222-2222-4222-8222-222222222222'),
  0::bigint, 'a member of C canNOT see tenant B''s catalog image');

-- ── 12. Member of B sees ONLY B's image (mirror check) ────────────────────
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id='product-images'),
  1::bigint, 'a member of B sees exactly one image — its own (never C''s)');

select finish();
rollback;
