-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8E.4 — tenant business/profile settings (NON-LEGAL, display only)
--
-- Adds an operator-editable BUSINESS PROFILE for the tenant: the display
-- identity that already appears on documents (name / phone / address /
-- legal_name / company_id, on public.tenants) plus three new columns —
-- `email`, `logo_url` (a private-bucket object path or external URL, signed on
-- read) and `display_vat_rate` (a NON-LEGAL default VAT rate shown on
-- estimates/drafts). Until now NO app path populated these columns
-- (create_tenant_with_owner sets only the names + locales), so documents
-- rendered a blank supplier identity.
--
-- ⚠️ LEGAL / SAFETY: This is DISPLAY configuration only. `display_vat_rate` is
-- an ESTIMATE input for the draft/internal preview — it does NOT issue a tax
-- invoice, does NOT set an immutable legal figure, and does NOT touch the
-- inert legal-invoicing family. legal_effective / the MADAF_LEGAL_* flags stay
-- OFF; the invoice_draft keeps its DRAFT watermark + "not a tax invoice"
-- notice + VAT-estimate wording unchanged. This is SEPARATE from the inert
-- M6B tenant_tax_settings (future-legal identity) — do NOT merge the two.
--
-- Access model (mirrors upsert_tenant_tax_settings):
--   • owner/admin of the SELECTED tenant may write via the RPC ONLY;
--   • sales_rep / anon / non-member: nothing;
--   • no direct tenants UPDATE from the client (the RPC is SECURITY DEFINER);
--   • the client-supplied tenant_id is never trusted (authorize_tenant).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. New business-profile columns on tenants ───────────────────────────
alter table public.tenants
  add column if not exists email text,
  add column if not exists logo_url text,
  add column if not exists display_vat_rate numeric(5, 4);

comment on column public.tenants.email is
  'Business contact email shown on documents/branding (M8E.4). Non-legal.';
comment on column public.tenants.logo_url is
  'Business logo (M8E.4): a private product-images bucket object path under <tenant_id>/branding/… (signed on read) OR an external http(s) URL. Never a public URL.';
comment on column public.tenants.display_vat_rate is
  'Default VAT rate for INTERNAL/DRAFT display only (fraction in [0,1), e.g. 0.1800). NON-LEGAL estimate input — does NOT issue a tax invoice or set a legal figure; legal_effective stays false.';

alter table public.tenants
  add constraint tenants_email_sane
    check (email is null
           or (char_length(email) <= 254 and position('@' in email) > 1)),
  add constraint tenants_logo_url_len
    check (logo_url is null or char_length(logo_url) <= 500),
  add constraint tenants_display_vat_rate_range
    check (display_vat_rate is null
           or (display_vat_rate >= 0 and display_vat_rate < 1));

-- ── 2. update_tenant_profile — owner/admin write RPC (the ONLY write path) ─
-- Updates the business-profile columns on the caller's SELECTED tenant. Names
-- are required (non-empty). Light sanity/normalization only. Persists display
-- configuration ONLY — issues nothing, no legal effect.
create or replace function public.update_tenant_profile(
  p_tenant_id uuid,
  p_name_ar text,
  p_name_he text,
  p_name_en text,
  p_phone text default null,
  p_email text default null,
  p_address_ar text default null,
  p_address_he text default null,
  p_address_en text default null,
  p_legal_name text default null,
  p_company_id text default null,
  p_display_vat_rate numeric default null,
  p_logo_url text default null
)
returns setof public.tenants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_ar text;
  v_he text;
  v_en text;
  v_email text;
  v_rate numeric;
begin
  v_tenant := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  v_ar := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_he := nullif(btrim(coalesce(p_name_he, '')), '');
  v_en := nullif(btrim(coalesce(p_name_en, '')), '');
  if v_ar is null or v_he is null or v_en is null then
    raise exception 'update_tenant_profile: name_ar, name_he and name_en are required'
      using errcode = '22023';
  end if;
  if char_length(v_ar) > 120 or char_length(v_he) > 120 or char_length(v_en) > 120 then
    raise exception 'update_tenant_profile: name too long (<=120)'
      using errcode = '22023';
  end if;

  v_email := nullif(btrim(lower(coalesce(p_email, ''))), '');
  if v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'update_tenant_profile: email is not a valid address'
      using errcode = '22023';
  end if;

  -- Round to the column scale (numeric(5,4)) BEFORE the guard so a direct RPC
  -- call with a value that rounds up to 1.0000 (>= 0.99995) is rejected with
  -- the friendly 22023 here, not a raw CHECK violation (23514) on write.
  v_rate := round(p_display_vat_rate, 4);
  if v_rate is not null and (v_rate < 0 or v_rate >= 1) then
    raise exception 'update_tenant_profile: display_vat_rate must be a fraction in [0, 1)'
      using errcode = '22023';
  end if;

  return query
  update public.tenants t set
    name_ar = v_ar,
    name_he = v_he,
    name_en = v_en,
    phone = left(nullif(btrim(coalesce(p_phone, '')), ''), 40),
    email = v_email,
    address_ar = left(nullif(btrim(coalesce(p_address_ar, '')), ''), 200),
    address_he = left(nullif(btrim(coalesce(p_address_he, '')), ''), 200),
    address_en = left(nullif(btrim(coalesce(p_address_en, '')), ''), 200),
    legal_name = left(nullif(btrim(coalesce(p_legal_name, '')), ''), 200),
    company_id = left(nullif(btrim(coalesce(p_company_id, '')), ''), 40),
    display_vat_rate = v_rate,
    logo_url = left(nullif(btrim(coalesce(p_logo_url, '')), ''), 500),
    updated_at = now()
  where t.id = v_tenant
  returning t.*;
end;
$$;

comment on function public.update_tenant_profile(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text) is
  'M8E.4: update a tenant''s BUSINESS PROFILE (owner/admin only), the ONLY write path for these columns. SECURITY DEFINER + authorize_tenant(owner/admin); light sanity/normalization only. DISPLAY configuration ONLY — display_vat_rate is a non-legal estimate rate; issues nothing, no legal effect, legal_effective stays false.';

revoke all on function public.update_tenant_profile(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.update_tenant_profile(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text) to authenticated, service_role;
