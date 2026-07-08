-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7D.1 — seed a starter category taxonomy on tenant creation
--
-- Staging smoke found that a freshly-onboarded tenant has ZERO categories,
-- so product creation is blocked (create_product requires a category that
-- belongs to the tenant — see validate_product_payload). The demo tenant only
-- has categories because supabase/seed.sql inserts them directly; a tenant
-- created through onboarding (create_tenant_with_owner) got none. Hosted
-- staging received migrations via `db push` (not seed.sql), so its onboarded
-- tenant had no categories at all.
--
-- Fix: create_tenant_with_owner now also inserts the same 6 starter categories
-- (identical ar/he/en/icon/color_hue/sort_order as seed.sql) for the NEW
-- tenant, inside the same transaction. This is the ONLY change — the function
-- signature, grants, auth/ownership checks, single-membership rule, and the
-- concurrent-onboarding handling are all preserved.
--
-- Safety: SECURITY DEFINER + search_path='' unchanged; categories are inserted
-- for the just-created tenant only (v_tenant_id); RLS/grants are not touched;
-- categories remain read-only to the app (still no create/update category RPC —
-- category editing/CRUD is a separate future change). No legal/payment change.
--
-- NOTE: existing tenants created BEFORE this migration are not backfilled;
-- re-onboard a fresh tenant to get the starter set (or add category editing
-- later).
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.create_tenant_with_owner(
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_default_locale public.locale_code default 'he'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant_id uuid;
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
  v_he text := nullif(trim(coalesce(p_name_he, '')), '');
  v_en text := nullif(trim(coalesce(p_name_en, '')), '');
begin
  if v_uid is null then
    raise exception 'create_tenant_with_owner: authentication required'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_users tu where tu.user_id = v_uid) then
    raise exception 'create_tenant_with_owner: user already belongs to a tenant'
      using errcode = '42501';
  end if;
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'create_tenant_with_owner: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if greatest(length(v_ar), length(v_he), length(v_en)) > 200 then
    raise exception 'create_tenant_with_owner: names must be 200 characters or fewer'
      using errcode = '22023';
  end if;

  insert into public.tenants (name_ar, name_he, name_en, default_locale, document_locale)
  values (v_ar, v_he, v_en, p_default_locale, p_default_locale)
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, v_uid, 'owner');

  -- Starter category taxonomy for the new tenant (mirrors supabase/seed.sql).
  -- Gives onboarding a usable set so products can be created immediately.
  insert into public.categories
    (tenant_id, name_ar, name_he, name_en, icon, color_hue, sort_order)
  values
    (v_tenant_id, 'مشروبات', 'משקאות', 'Drinks', '🥤', 197, 1),
    (v_tenant_id, 'سناكات وحلويات', 'חטיפים ומתוקים', 'Snacks & Sweets', '🥨', 28, 2),
    (v_tenant_id, 'قهوة وشاي', 'קפה ותה', 'Coffee & Tea', '☕', 25, 3),
    (v_tenant_id, 'معلبات ومواد جافة', 'שימורים ויבשים', 'Canned & Pantry', '🥫', 8, 4),
    (v_tenant_id, 'ألبان', 'מוצרי חלב', 'Dairy', '🥛', 210, 5),
    (v_tenant_id, 'تنظيف ومستهلكات', 'ניקיון וחד־פעמי', 'Cleaning', '🧼', 168, 6);

  return v_tenant_id;
exception
  -- Concurrent onboarding (two tabs / double submit) loses the race on the
  -- unique(user_id) backstop; surface it as the same clean "already a
  -- member" error instead of a raw constraint violation. The whole function
  -- is one transaction, so the just-inserted tenant rolls back too — no
  -- orphan tenant is left behind.
  when unique_violation then
    raise exception 'create_tenant_with_owner: user already belongs to a tenant'
      using errcode = '42501';
end;
$$;

comment on function public.create_tenant_with_owner(text, text, text, public.locale_code) is
  'Onboarding: a membership-less authenticated user creates a tenant and becomes its owner (atomic). M4A single-membership. M7D.1: also seeds a starter category taxonomy for the new tenant so products can be created immediately.';

-- Grants are preserved by CREATE OR REPLACE (authenticated + service_role
-- EXECUTE; anon/public none) — re-assert defensively.
revoke all on function public.create_tenant_with_owner(text, text, text, public.locale_code) from public, anon;
grant execute on function public.create_tenant_with_owner(text, text, text, public.locale_code) to authenticated, service_role;
