-- ═══════════════════════════════════════════════════════════════════════
-- Madaf — LOCAL auth bootstrap (M4A)  ·  NOT run automatically
--
-- Creates demo Supabase Auth users and attaches them to tenants so you can
-- test authenticated mode locally. Run against the LOCAL stack only:
--
--   supabase db reset            # clean schema + seed
--   docker exec -i supabase_db_Madaf psql -U postgres -d postgres \
--     -f - < supabase/bootstrap-auth.sql
--
-- Passwords are bcrypt-hashed via pgcrypto (GoTrue accepts these). These
-- are throwaway local credentials — never use in any hosted project.
--
-- Users created (password for all: "madaf-demo-1234"):
--   owner@madaf.local    → owner  of the seeded demo tenant (11111111…)
--   admin@madaf.local    → admin  of the seeded demo tenant
--   rep@madaf.local      → sales_rep of the seeded demo tenant
--   other@madaf.local    → owner  of a SECOND tenant (isolation testing)
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

do $$
declare
  v_demo_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_other_tenant uuid;
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_admin uuid := '00000000-0000-4000-8000-000000000002';
  v_rep   uuid := '00000000-0000-4000-8000-000000000003';
  v_other uuid := '00000000-0000-4000-8000-000000000004';
  v_pw text := crypt('madaf-demo-1234', gen_salt('bf'));
begin
  -- Second tenant for cross-tenant isolation testing.
  insert into public.tenants (name_ar, name_he, name_en)
  values ('مورّد آخر', 'ספק אחר', 'Other Supplier')
  on conflict do nothing
  returning id into v_other_tenant;
  if v_other_tenant is null then
    select id into v_other_tenant from public.tenants where name_en = 'Other Supplier' limit 1;
  end if;

  -- Auth users (email confirmed so password login works immediately).
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data)
  values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner@madaf.local', v_pw, now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}'),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin@madaf.local', v_pw, now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}'),
    (v_rep, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rep@madaf.local', v_pw, now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}'),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'other@madaf.local', v_pw, now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}')
  on conflict (id) do nothing;

  -- Email identities (GoTrue looks these up for password sign-in).
  insert into auth.identities
    (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), v_owner, v_owner::text,
     jsonb_build_object('sub', v_owner::text, 'email', 'owner@madaf.local', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_admin, v_admin::text,
     jsonb_build_object('sub', v_admin::text, 'email', 'admin@madaf.local', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_rep, v_rep::text,
     jsonb_build_object('sub', v_rep::text, 'email', 'rep@madaf.local', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_other, v_other::text,
     jsonb_build_object('sub', v_other::text, 'email', 'other@madaf.local', 'email_verified', true),
     'email', now(), now(), now())
  on conflict do nothing;

  -- Memberships.
  insert into public.tenant_users (tenant_id, user_id, role) values
    (v_demo_tenant, v_owner, 'owner'),
    (v_demo_tenant, v_admin, 'admin'),
    (v_demo_tenant, v_rep, 'sales_rep'),
    (v_other_tenant, v_other, 'owner')
  on conflict (tenant_id, user_id) do nothing;

  raise notice 'bootstrap done: demo tenant % / other tenant %', v_demo_tenant, v_other_tenant;
end $$;
