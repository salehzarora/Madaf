-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M7G — new-store SELF-SIGNUP links + pending requests
--
-- Until now every store/customer was created by the warehouse owner/admin
-- (M7F create_customer). This adds a SUPPLIER-CONTROLLED self-registration
-- path: an owner/admin issues a tenant-scoped tokenized "join" link; a
-- prospective store opens it (NO login, NO catalog) and submits its details;
-- the submission lands as a PENDING request the owner/admin reviews and
-- approves — approval materialises a real customers row (reusing the
-- create_customer INSERT). Nothing is exposed to the visitor beyond the form.
--
-- Mirrors the existing hardened primitives exactly:
--   - customer_access_links (token_hash-only, owner/admin insert/revoke RPCs),
--   - _resolve_token (raw token hashed IN-DB, service_role only),
--   - the token rate limiter (_token_rate_exceeded/_record_token_failure),
--   - create_customer (the approve step's INSERT column list),
--   - authorize_tenant (tenant DERIVED, never client-supplied).
--
-- No catalog/product exposure. Anon has ZERO table access — visitors submit
-- ONLY through the anon SECURITY DEFINER submit RPC, which derives tenant +
-- link from the token. A per-link pending cap bounds spam through a valid
-- link (the shared limiter only counts token-RESOLUTION failures).
--
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Tables ────────────────────────────────────────────────────────────────

-- Tenant-scoped signup link. token_hash only (raw token returned once at
-- creation, never stored). Mirrors customer_access_links minus customer_id.
create table public.customer_signup_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_hash text not null unique,
  token_preview text,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A submitted store, awaiting owner/admin review. Status is DERIVED from
-- approved_at / rejected_at (no stored enum — mirrors tenant_invitations).
create table public.customer_signup_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  link_id uuid not null references public.customer_signup_links (id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  city_ar text,
  city_he text,
  city_en text,
  address text,
  notes text,
  approved_at timestamptz,
  rejected_at timestamptz,
  approved_customer_id uuid,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FK: an approved request's customer must belong to its tenant.
  foreign key (tenant_id, approved_customer_id)
    references public.customers (tenant_id, id) on delete set null
);

create index customer_signup_requests_tenant_idx
  on public.customer_signup_requests (tenant_id, created_at desc);
create index customer_signup_links_tenant_idx
  on public.customer_signup_links (tenant_id, created_at desc);

create trigger customer_signup_links_set_updated_at
  before update on public.customer_signup_links
  for each row execute function public.set_updated_at();
create trigger customer_signup_requests_set_updated_at
  before update on public.customer_signup_requests
  for each row execute function public.set_updated_at();

-- ── RLS + grants ─────────────────────────────────────────────────────────
-- Owner/admin READ their tenant's links/requests; ALL writes via RPC only;
-- anon has NOTHING (no policy, no grant). token_hash never selectable.

alter table public.customer_signup_links enable row level security;
alter table public.customer_signup_requests enable row level security;

revoke all on public.customer_signup_links from anon, authenticated;
revoke all on public.customer_signup_requests from anon, authenticated;

grant select (id, tenant_id, token_preview, label, expires_at, revoked_at,
              last_used_at, created_by, created_at, updated_at)
  on public.customer_signup_links to authenticated;
grant select on public.customer_signup_requests to authenticated;

grant select, insert, update, delete on public.customer_signup_links to service_role;
grant select, insert, update, delete on public.customer_signup_requests to service_role;

create policy "signup_links: owner/admin read"
  on public.customer_signup_links for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "signup_requests: owner/admin read"
  on public.customer_signup_requests for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── Link create / revoke (owner/admin) ───────────────────────────────────

create or replace function public.insert_customer_signup_link(
  p_tenant_id uuid,
  p_token_hash text,
  p_token_preview text default null,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  -- Tenant is the NAMED tenant, accepted only if the caller is owner/admin of
  -- it (M4C — every tenant-scoped RPC takes an explicit p_tenant_id).
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'insert_customer_signup_link: invalid token hash' using errcode = '22023';
  end if;
  insert into public.customer_signup_links
    (tenant_id, token_hash, token_preview, label, expires_at, created_by)
  values
    (v_tenant, p_token_hash,
     nullif(trim(coalesce(p_token_preview, '')), ''),
     nullif(trim(coalesce(p_label, '')), ''),
     p_expires_at, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.insert_customer_signup_link(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.insert_customer_signup_link(uuid, text, text, text, timestamptz) to authenticated, service_role;

create or replace function public.revoke_customer_signup_link(
  p_tenant_id uuid,
  p_link_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.customer_signup_links l
     set revoked_at = coalesce(l.revoked_at, now())
   where l.id = p_link_id and l.tenant_id = v_tenant;
  if not found then
    raise exception 'revoke_customer_signup_link: link is unknown or belongs to another tenant'
      using errcode = '22023';
  end if;
  return p_link_id;
end;
$$;
revoke all on function public.revoke_customer_signup_link(uuid, uuid) from public, anon;
grant execute on function public.revoke_customer_signup_link(uuid, uuid) to authenticated, service_role;

-- ── _resolve_signup_token — PRIVATE (service_role only) ───────────────────
-- Raw token hashed HERE; a leaked hash is not replayable. Returns the link's
-- tenant + id for a valid/non-revoked/non-expired token, else raises.

create or replace function public._resolve_signup_token(p_raw_token text)
returns table (tenant_id uuid, link_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_link public.customer_signup_links%rowtype;
  v_hash text;
begin
  if p_raw_token is null or length(p_raw_token) < 16 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_raw_token, 'UTF8')), 'hex');
  select * into v_link
  from public.customer_signup_links l
  where l.token_hash = v_hash;
  if not found then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'link revoked' using errcode = 'P0003';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'link expired' using errcode = 'P0004';
  end if;
  return query select v_link.tenant_id, v_link.id;
end;
$$;
revoke all on function public._resolve_signup_token(text) from public, anon, authenticated;
grant execute on function public._resolve_signup_token(text) to service_role;

-- ── submit_customer_signup_request — ANON, rate-limited, per-link cap ─────
-- Mirrors create_order_request_from_token: check the shared limiter, resolve
-- the token (record + return null on failure so the counter commits), then
-- validate + insert. Tenant + link come from the token, NEVER the client.
-- Returns true on success, null/false otherwise (neutral to the visitor).

create or replace function public.submit_customer_signup_request(
  p_token text,
  p_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_city_ar text default null,
  p_city_he text default null,
  p_city_en text default null,
  p_address text default null,
  p_notes text default null
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_link uuid;
  v_fp text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_pending int;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  -- Shared token rate limiter (resolution failures only).
  if public._token_rate_exceeded('signup_submit', v_fp) then
    return null;
  end if;
  begin
    select tenant_id, link_id into v_tenant, v_link
    from public._resolve_signup_token(p_token);
  exception when others then
    perform public._record_token_failure('signup_submit', v_fp);
    return null;
  end;

  -- Content validation AFTER a valid token (never rate-limited). A blank name
  -- or over-long field is a bad submission, not a token attack.
  if v_name is null then
    raise exception 'signup: name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200
     or coalesce(length(trim(p_contact_name)), 0) > 200
     or coalesce(length(trim(p_phone)), 0) > 40
     or coalesce(length(v_email), 0) > 254
     or greatest(coalesce(length(trim(p_city_ar)), 0),
                 coalesce(length(trim(p_city_he)), 0),
                 coalesce(length(trim(p_city_en)), 0)) > 120
     or coalesce(length(trim(p_address)), 0) > 300
     or coalesce(length(trim(p_notes)), 0) > 2000 then
    raise exception 'signup: a field exceeds its maximum length' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'signup: invalid email' using errcode = '22023';
  end if;

  -- Per-link spam cap: bound how many PENDING requests one valid link can
  -- accumulate (the shared limiter can't stop floods through a valid token).
  select count(*) into v_pending
  from public.customer_signup_requests r
  where r.link_id = v_link and r.approved_at is null and r.rejected_at is null;
  if v_pending >= 50 then
    return null;
  end if;

  insert into public.customer_signup_requests
    (tenant_id, link_id, name, contact_name, phone, email,
     city_ar, city_he, city_en, address, notes)
  values
    (v_tenant, v_link, v_name,
     nullif(trim(coalesce(p_contact_name, '')), ''),
     nullif(trim(coalesce(p_phone, '')), ''),
     v_email,
     nullif(trim(coalesce(p_city_ar, '')), ''),
     nullif(trim(coalesce(p_city_he, '')), ''),
     nullif(trim(coalesce(p_city_en, '')), ''),
     nullif(trim(coalesce(p_address, '')), ''),
     nullif(trim(coalesce(p_notes, '')), ''));

  update public.customer_signup_links set last_used_at = now() where id = v_link;
  return true;
end;
$$;
revoke all on function public.submit_customer_signup_request(
  text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_customer_signup_request(
  text, text, text, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

-- ── approve / reject (owner/admin) ────────────────────────────────────────

create or replace function public.approve_customer_signup_request(
  p_tenant_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_req public.customer_signup_requests%rowtype;
  v_customer_id uuid;
  v_notes text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  select * into v_req
  from public.customer_signup_requests r
  where r.id = p_request_id and r.tenant_id = v_tenant;
  if not found then
    raise exception 'approve_customer_signup_request: request unknown or another tenant'
      using errcode = '22023';
  end if;
  if v_req.approved_at is not null or v_req.rejected_at is not null then
    raise exception 'approve_customer_signup_request: request already reviewed'
      using errcode = '22023';
  end if;

  -- Keep the submitted email (customers has no email column) by folding it
  -- into the internal notes so the supplier still has it.
  v_notes := case
    when v_req.email is not null and v_req.email <> ''
      then trim(both e'\n' from coalesce(v_req.notes, '') || e'\nEmail: ' || v_req.email)
    else v_req.notes
  end;

  -- Materialise the customer — SAME column list as create_customer (M7F.2).
  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes)
  values
    (v_tenant, v_req.name, v_req.contact_name, v_req.phone,
     v_req.city_ar, v_req.city_he, v_req.city_en, v_req.address, 'grocery', v_notes)
  returning id into v_customer_id;

  update public.customer_signup_requests
     set approved_at = now(),
         approved_customer_id = v_customer_id,
         reviewed_by = (select auth.uid())
   where id = p_request_id;
  return v_customer_id;
end;
$$;
revoke all on function public.approve_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.approve_customer_signup_request(uuid, uuid) to authenticated, service_role;

create or replace function public.reject_customer_signup_request(
  p_tenant_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.customer_signup_requests r
     set rejected_at = now(), reviewed_by = (select auth.uid())
   where r.id = p_request_id and r.tenant_id = v_tenant
     and r.approved_at is null and r.rejected_at is null;
  if not found then
    raise exception 'reject_customer_signup_request: request unknown, another tenant, or already reviewed'
      using errcode = '22023';
  end if;
  return p_request_id;
end;
$$;
revoke all on function public.reject_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.reject_customer_signup_request(uuid, uuid) to authenticated, service_role;
