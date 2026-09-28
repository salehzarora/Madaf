-- Native push V1. No order RPC/trigger changes: dispatch is strictly post-commit.
-- Tokens are never SELECTable by anon/authenticated, including the registrant.
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  installation_id uuid not null unique,
  platform text not null check (platform = 'android'),
  fcm_token text not null unique check (length(fcm_token) between 20 and 4096 and fcm_token ~ '^[A-Za-z0-9_:\-]+$'),
  locale text not null default 'he' check (locale in ('ar','he','en')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  foreign key (tenant_id,user_id) references public.tenant_users(tenant_id,user_id) on delete cascade
);
create index push_devices_tenant_enabled_idx on public.push_devices(tenant_id,id) where enabled;
create index push_devices_session_idx on public.push_devices(session_id);
create index push_devices_membership_idx on public.push_devices(tenant_id,user_id);
create trigger push_devices_updated before update on public.push_devices
  for each row execute function public.set_updated_at();
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public, anon, authenticated;
grant select,insert,update,delete on public.push_devices to service_role;

-- Global installation/token uniqueness intentionally means one signed-in account
-- and selected tenant at a time. Reassociation removes the previous binding.
-- A live auth session is mandatory even for a still-unexpired, signed JWT.
create function public.register_push_device(p_tenant_id uuid, p_installation_id uuid,
  p_fcm_token text, p_locale text default 'he', p_enabled boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if v_uid is null or v_sid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.authorize_tenant(p_tenant_id, array['owner','admin','sales_rep']::public.tenant_role[]);
  perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=v_sid and s.user_id=v_uid and (s.not_after is null or s.not_after > now())
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until <= now())
    for key share of s;
  if not found then raise exception 'Active session required' using errcode='42501'; end if;
  if p_installation_id is null or p_fcm_token is null or length(p_fcm_token) not between 20 and 4096
    or p_fcm_token !~ '^[A-Za-z0-9_:\-]+$'
    or p_locale is null or p_locale not in ('ar','he','en') or p_enabled is null then
    raise exception 'Invalid device payload' using errcode='22023';
  end if;
  -- Serialize device reassociation/upsert, including token rotation and same-token
  -- WebView storage reset. Never let a unique conflict expose a token in an error.
  perform pg_advisory_xact_lock(761504001);
  -- The installation UUID is not an ownership credential. Account switching
  -- may reuse the same private native token, but knowing an ID alone cannot
  -- replace another user's association with an unrelated token.
  if exists(select 1 from public.push_devices where installation_id=p_installation_id
    and user_id<>v_uid and fcm_token<>p_fcm_token) then
    raise exception 'Device association unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.push_devices where installation_id=p_installation_id)
    and (select count(*) from public.push_devices where user_id=v_uid) >= 20 then
    raise exception 'Device limit reached' using errcode='22023';
  end if;
  delete from public.push_devices where fcm_token=p_fcm_token and installation_id<>p_installation_id;
  insert into public.push_devices(tenant_id,user_id,session_id,installation_id,platform,fcm_token,locale,enabled)
    values(p_tenant_id,v_uid,v_sid,p_installation_id,'android',p_fcm_token,p_locale,p_enabled)
    on conflict(installation_id) do update set tenant_id=excluded.tenant_id, user_id=excluded.user_id,
      session_id=excluded.session_id, fcm_token=excluded.fcm_token, locale=excluded.locale,
      enabled=excluded.enabled,last_seen_at=now();
end; $$;
revoke all on function public.register_push_device(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.register_push_device(uuid,uuid,text,text,boolean) to authenticated;

create function public.disable_my_push_device(p_installation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.push_devices set enabled=false where installation_id=p_installation_id
    and user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid;
end; $$;
revoke all on function public.disable_my_push_device(uuid) from public,anon;
grant execute on function public.disable_my_push_device(uuid) to authenticated;

-- At-most-once best-effort dispatch claim. Does NOT run in the order transaction.
-- No sensitive payload/token snapshot. Replayed order submissions cannot notify twice.
create table public.push_order_dispatches (
  order_id uuid primary key references public.orders(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.push_order_dispatches enable row level security;
revoke all on public.push_order_dispatches from public,anon,authenticated;
grant select,insert on public.push_order_dispatches to service_role;

create function public.claim_new_order_push(p_order_id uuid default null,p_public_ref text default null)
returns table(order_id uuid,order_number text)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  perform public.assert_service_role('claim_new_order_push');
  if (p_order_id is null) = (p_public_ref is null) then return; end if;
  select o.* into v_order from public.orders o where
    ((p_order_id is not null and o.id=p_order_id) or (p_public_ref is not null and o.public_ref=p_public_ref))
    and o.created_at >= now()-interval '15 minutes' and o.status='new';
  if not found then return; end if;
  insert into public.push_order_dispatches(order_id) values(v_order.id) on conflict do nothing;
  if not found then return; end if;
  return query select v_order.id,v_order.order_number;
end; $$;
revoke all on function public.claim_new_order_push(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_new_order_push(uuid,text) to service_role;

create function public.new_order_push_recipients(p_order_id uuid,p_after_id uuid default null)
returns table(device_id uuid,fcm_token text,locale text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_service_role('new_order_push_recipients');
  return query select d.id,d.fcm_token,d.locale from public.push_devices d
    join public.orders o on o.id=p_order_id and o.tenant_id=d.tenant_id
    join public.push_order_dispatches dispatch on dispatch.order_id=o.id
    join public.tenant_users tu on tu.tenant_id=d.tenant_id and tu.user_id=d.user_id
    join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
    join auth.users u on u.id=d.user_id
    where d.enabled and tu.role in ('owner','admin')
    and (s.not_after is null or s.not_after>now())
    and (u.banned_until is null or u.banned_until<=now())
    and not coalesce(u.is_anonymous,false)
    and (p_after_id is null or d.id>p_after_id)
    order by d.id limit 100;
end; $$;
revoke all on function public.new_order_push_recipients(uuid,uuid) from public,anon,authenticated;
grant execute on function public.new_order_push_recipients(uuid,uuid) to service_role;

-- Compare-and-disable: a failed old token must never disable a freshly rotated token.
create function public.disable_invalid_push_token(p_device_id uuid,p_expected_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_service_role('disable_invalid_push_token');
  update public.push_devices set enabled=false where id=p_device_id and fcm_token=p_expected_token;
end; $$;
revoke all on function public.disable_invalid_push_token(uuid,text) from public,anon,authenticated;
grant execute on function public.disable_invalid_push_token(uuid,text) to service_role;
