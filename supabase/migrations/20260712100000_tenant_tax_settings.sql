-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6B — tenant_tax_settings (INERT tax configuration)
--
-- ⚠️ LEGAL / SAFETY: This migration adds a per-tenant TAX SETTINGS record and
-- its read/upsert RPCs. It adds NO legal-invoice issuing path. Saving these
-- settings does NOT issue a tax invoice, does NOT request an allocation
-- number (מספר הקצאה), and does NOT contact any tax authority or provider.
-- `legal_invoicing_ready` is an operator note ONLY — it does NOT enable
-- issuing by itself; even when true, the server-side feature flags
-- (MADAF_LEGAL_INVOICING_ENABLED / MADAF_TAX_PROVIDER_MODE /
-- MADAF_LEGAL_NUMBERING_ENABLED) stay OFF/disabled by default and no issuing
-- code exists yet. The M5 invoice_draft stays a DRAFT with its
-- "not a tax invoice" notice + DRAFT watermark unchanged. See
-- docs/LEGAL_INVOICING_ARCHITECTURE.md and docs/DOCUMENTS_AND_INVOICES_GUIDE.md.
--
-- Access model (mirrors the existing schema, docs/AUTH_AND_ACCESS_MODEL.md):
--   • deny-by-default RLS; owner/admin of the SELECTED tenant may read + write;
--   • sales_rep, anon and non-members get NOTHING;
--   • writes go EXCLUSIVELY through the SECURITY DEFINER upsert RPC
--     (authorize_tenant owner/admin) — no direct table writes;
--   • no secrets are stored here (provider credentials/mode are server-only
--     env, never per-tenant DB rows).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────────
create table public.tenant_tax_settings (
  id uuid primary key default gen_random_uuid(),
  -- One settings row per tenant.
  tenant_id uuid not null unique
    references public.tenants (id) on delete cascade,
  -- Legal identity (appears on a FUTURE legal invoice, frozen at issue then).
  legal_name text,
  business_registration_number text,   -- ח.פ / company registration
  vat_registration_number text,        -- עוסק number
  vat_registration_type text,          -- e.g. עוסק מורשה / עוסק פטור / חברה
  country_code text not null default 'IL',
  default_vat_rate numeric(5, 4),      -- e.g. 0.1800 (fraction, like products.vat_rate)
  invoice_language text,               -- 'ar' | 'he' | 'en' (nullable)
  -- Registered address.
  street text,
  city text,
  postal_code text,
  country text,
  -- Contact for invoicing correspondence.
  contact_email text,
  contact_phone text,
  -- Operator readiness NOTE ONLY — does NOT enable issuing (flags stay OFF).
  legal_invoicing_ready boolean not null default false,
  readiness_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  -- Basic length / format sanity ONLY. This is NOT full tax-law validation
  -- (that requires a professional review + verified official rules — M6G).
  constraint tenant_tax_settings_legal_name_len
    check (legal_name is null or char_length(legal_name) <= 200),
  constraint tenant_tax_settings_business_reg_len
    check (business_registration_number is null
           or char_length(business_registration_number) <= 40),
  constraint tenant_tax_settings_vat_reg_len
    check (vat_registration_number is null
           or char_length(vat_registration_number) <= 40),
  constraint tenant_tax_settings_vat_type_len
    check (vat_registration_type is null
           or char_length(vat_registration_type) <= 60),
  constraint tenant_tax_settings_country_code_fmt
    check (char_length(country_code) between 2 and 3),
  constraint tenant_tax_settings_default_vat_rate_range
    check (default_vat_rate is null
           or (default_vat_rate >= 0 and default_vat_rate < 1)),
  constraint tenant_tax_settings_invoice_language_valid
    check (invoice_language is null or invoice_language in ('ar', 'he', 'en')),
  constraint tenant_tax_settings_street_len
    check (street is null or char_length(street) <= 200),
  constraint tenant_tax_settings_city_len
    check (city is null or char_length(city) <= 120),
  constraint tenant_tax_settings_postal_len
    check (postal_code is null or char_length(postal_code) <= 20),
  constraint tenant_tax_settings_country_len
    check (country is null or char_length(country) <= 80),
  constraint tenant_tax_settings_contact_email_sane
    check (contact_email is null
           or (char_length(contact_email) <= 254 and position('@' in contact_email) > 1)),
  constraint tenant_tax_settings_contact_phone_len
    check (contact_phone is null or char_length(contact_phone) <= 40),
  constraint tenant_tax_settings_readiness_notes_len
    check (readiness_notes is null or char_length(readiness_notes) <= 2000)
);

comment on table public.tenant_tax_settings is
  'Per-tenant tax configuration for FUTURE legal invoicing (M6B, INERT). Does NOT enable issuing: legal_invoicing_ready is an operator note only; issuing also requires server-side feature flags (default OFF) + machinery that does not exist yet. No secrets stored here. owner/admin read+write via RPC; sales_rep/anon/non-member: none.';

comment on column public.tenant_tax_settings.legal_invoicing_ready is
  'Operator readiness note ONLY. Does NOT enable legal invoice issuing — issuing additionally requires the server-side feature flags (MADAF_LEGAL_INVOICING_ENABLED etc., default OFF) and machinery that does not exist in M6B.';

create trigger tenant_tax_settings_set_updated_at
  before update on public.tenant_tax_settings
  for each row execute function public.set_updated_at();

-- ── 2. Grants + RLS (deny-by-default; RPC-only writes) ───────────────────
alter table public.tenant_tax_settings enable row level security;

-- anon: nothing. authenticated: column SELECT only (RLS scopes to owner/admin
-- of the row's tenant); NO write grants (writes go through the upsert RPC).
-- Strip the default-ACL dangerous privileges exactly like the other M4/M5
-- tables so a future policy slip cannot open a write path.
revoke all on public.tenant_tax_settings from anon, authenticated;
revoke truncate, references, trigger, maintain
  on public.tenant_tax_settings from anon, authenticated;
grant select on public.tenant_tax_settings to authenticated;
grant select, insert, update, delete on public.tenant_tax_settings to service_role;

-- Read: owner/admin of the tenant only. No sales_rep, no anon, no non-member.
create policy "tenant_tax_settings: owner/admin read their tenant"
  on public.tenant_tax_settings for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- Deliberately NO insert/update/delete policy (and no write grant): writes go
-- EXCLUSIVELY through upsert_tenant_tax_settings below (RPC-only), so no client
-- can forge/mutate another tenant's tax identity via a direct write.

create index tenant_tax_settings_tenant_idx
  on public.tenant_tax_settings (tenant_id);

-- ── 3. get_tenant_tax_settings — owner/admin read RPC ────────────────────
create or replace function public.get_tenant_tax_settings(p_tenant_id uuid)
returns setof public.tenant_tax_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  -- Membership + role gate: only an owner/admin of the NAMED tenant. The
  -- client-supplied tenant_id is never trusted (authorize_tenant verifies it
  -- is one of the caller's own memberships, else 42501).
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  return query
    select * from public.tenant_tax_settings t where t.tenant_id = v_tenant;
end;
$$;

comment on function public.get_tenant_tax_settings(uuid) is
  'M6B: read a tenant''s tax settings (owner/admin only). Returns 0 or 1 row. SECURITY DEFINER + authorize_tenant(owner/admin). No issuing side effects.';

revoke all on function public.get_tenant_tax_settings(uuid) from public, anon;
grant execute on function public.get_tenant_tax_settings(uuid) to authenticated, service_role;

-- ── 4. upsert_tenant_tax_settings — owner/admin write RPC ────────────────
-- The ONLY write path. Validates lightly, normalizes/truncates safely, and
-- records updated_by. Does NOT (and cannot) issue anything: it only persists
-- configuration. legal_invoicing_ready is stored as given but has no effect
-- on issuing (no issuing code exists; the feature flags stay OFF).
create or replace function public.upsert_tenant_tax_settings(
  p_tenant_id uuid,
  p_legal_name text default null,
  p_business_registration_number text default null,
  p_vat_registration_number text default null,
  p_vat_registration_type text default null,
  p_country_code text default null,
  p_default_vat_rate numeric default null,
  p_invoice_language text default null,
  p_street text default null,
  p_city text default null,
  p_postal_code text default null,
  p_country text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_legal_invoicing_ready boolean default false,
  p_readiness_notes text default null
)
returns setof public.tenant_tax_settings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_country_code text;
  v_invoice_language text;
  v_default_vat_rate numeric;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Normalize/truncate safely. Basic sanity only — NOT legal validation.
  v_country_code := upper(nullif(btrim(coalesce(p_country_code, '')), ''));
  if v_country_code is null then
    v_country_code := 'IL';
  end if;
  if char_length(v_country_code) not between 2 and 3 then
    raise exception 'upsert_tenant_tax_settings: country_code must be 2-3 letters'
      using errcode = '22023';
  end if;

  v_invoice_language := nullif(btrim(lower(coalesce(p_invoice_language, ''))), '');
  if v_invoice_language is not null and v_invoice_language not in ('ar', 'he', 'en') then
    raise exception 'upsert_tenant_tax_settings: invoice_language must be ar/he/en'
      using errcode = '22023';
  end if;

  v_default_vat_rate := p_default_vat_rate;
  if v_default_vat_rate is not null and (v_default_vat_rate < 0 or v_default_vat_rate >= 1) then
    raise exception 'upsert_tenant_tax_settings: default_vat_rate must be a fraction in [0, 1)'
      using errcode = '22023';
  end if;

  return query
  insert into public.tenant_tax_settings as t (
    tenant_id, legal_name, business_registration_number, vat_registration_number,
    vat_registration_type, country_code, default_vat_rate, invoice_language,
    street, city, postal_code, country, contact_email, contact_phone,
    legal_invoicing_ready, readiness_notes, updated_by)
  values (
    v_tenant,
    left(nullif(btrim(coalesce(p_legal_name, '')), ''), 200),
    left(nullif(btrim(coalesce(p_business_registration_number, '')), ''), 40),
    left(nullif(btrim(coalesce(p_vat_registration_number, '')), ''), 40),
    left(nullif(btrim(coalesce(p_vat_registration_type, '')), ''), 60),
    v_country_code,
    v_default_vat_rate,
    v_invoice_language,
    left(nullif(btrim(coalesce(p_street, '')), ''), 200),
    left(nullif(btrim(coalesce(p_city, '')), ''), 120),
    left(nullif(btrim(coalesce(p_postal_code, '')), ''), 20),
    left(nullif(btrim(coalesce(p_country, '')), ''), 80),
    left(nullif(btrim(lower(coalesce(p_contact_email, ''))), ''), 254),
    left(nullif(btrim(coalesce(p_contact_phone, '')), ''), 40),
    coalesce(p_legal_invoicing_ready, false),
    left(nullif(btrim(coalesce(p_readiness_notes, '')), ''), 2000),
    (select auth.uid()))
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name,
    business_registration_number = excluded.business_registration_number,
    vat_registration_number = excluded.vat_registration_number,
    vat_registration_type = excluded.vat_registration_type,
    country_code = excluded.country_code,
    default_vat_rate = excluded.default_vat_rate,
    invoice_language = excluded.invoice_language,
    street = excluded.street,
    city = excluded.city,
    postal_code = excluded.postal_code,
    country = excluded.country,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    legal_invoicing_ready = excluded.legal_invoicing_ready,
    readiness_notes = excluded.readiness_notes,
    updated_by = excluded.updated_by
  returning t.*;
end;
$$;

comment on function public.upsert_tenant_tax_settings(uuid, text, text, text, text, text, numeric, text, text, text, text, text, text, text, boolean, text) is
  'M6B: create/update a tenant''s tax settings (owner/admin only), the ONLY write path. SECURITY DEFINER + authorize_tenant(owner/admin); light sanity/normalization only (NOT tax-law validation). Persists configuration ONLY — issues NOTHING, requests NO allocation number, calls NO provider. legal_invoicing_ready does not enable issuing.';

revoke all on function public.upsert_tenant_tax_settings(uuid, text, text, text, text, text, numeric, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.upsert_tenant_tax_settings(uuid, text, text, text, text, text, numeric, text, text, text, text, text, text, text, boolean, text) to authenticated, service_role;
