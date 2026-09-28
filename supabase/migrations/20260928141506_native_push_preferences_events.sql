-- Native push V1.2: private preference/event bookkeeping. No network in transactions.
create table public.push_notification_preferences (
  tenant_id uuid not null, user_id uuid not null,
  new_order boolean not null default true,
  signup_request boolean not null default true,
  low_stock boolean not null default true,
  order_status boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,user_id),
  foreign key(tenant_id,user_id) references public.tenant_users(tenant_id,user_id) on delete cascade
);
alter table public.push_notification_preferences enable row level security;
revoke all on public.push_notification_preferences from public,anon,authenticated;
grant select on public.push_notification_preferences to service_role;
create trigger push_preferences_updated before update on public.push_notification_preferences
  for each row execute function public.set_updated_at();

-- Called only by guarded preference RPCs; membership and session are current DB facts.
create function public._push_preference_user(p_tenant_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid := auth.uid(); v_sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if v_uid is null or v_sid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.authorize_tenant(p_tenant_id,array['owner','admin','sales_rep']::public.tenant_role[]);
  perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=v_sid and s.user_id=v_uid and (s.not_after is null or s.not_after>now())
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
    for key share of s;
  if not found then raise exception 'Active session required' using errcode='42501'; end if;
  return v_uid;
end; $$;
revoke all on function public._push_preference_user(uuid) from public,anon,authenticated;

create function public.get_my_push_preferences(p_tenant_id uuid)
returns table(new_order boolean,signup_request boolean,low_stock boolean,order_status boolean)
language plpgsql security definer set search_path='' as $$
declare v_uid uuid := public._push_preference_user(p_tenant_id);
begin
  return query select coalesce(p.new_order,true),coalesce(p.signup_request,true),
    coalesce(p.low_stock,true),coalesce(p.order_status,false)
    from (select 1) seed left join public.push_notification_preferences p
      on p.tenant_id=p_tenant_id and p.user_id=v_uid;
end; $$;
create function public.save_my_push_preferences(p_tenant_id uuid,p_new_order boolean,
  p_signup_request boolean,p_low_stock boolean,p_order_status boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid := public._push_preference_user(p_tenant_id);
begin
  if p_new_order is null or p_signup_request is null or p_low_stock is null or p_order_status is null then
    raise exception 'Invalid preferences' using errcode='22023';
  end if;
  insert into public.push_notification_preferences(tenant_id,user_id,new_order,signup_request,low_stock,order_status)
    values(p_tenant_id,v_uid,p_new_order,p_signup_request,p_low_stock,p_order_status)
    on conflict(tenant_id,user_id) do update set new_order=excluded.new_order,
      signup_request=excluded.signup_request,low_stock=excluded.low_stock,order_status=excluded.order_status;
end; $$;
revoke all on function public.get_my_push_preferences(uuid) from public,anon;
revoke all on function public.save_my_push_preferences(uuid,boolean,boolean,boolean,boolean) from public,anon;
grant execute on function public.get_my_push_preferences(uuid) to authenticated;
grant execute on function public.save_my_push_preferences(uuid,boolean,boolean,boolean,boolean) to authenticated;

-- Shared SEND-time security boundary. No recipient snapshots in event records.
create function public.push_event_recipients(p_tenant_id uuid,p_event text,
  p_exclude_user_id uuid default null,p_after_id uuid default null)
returns table(device_id uuid,fcm_token text,locale text)
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_service_role('push_event_recipients');
  if p_event is null or p_event not in ('new_order','signup_request','low_stock','order_status') then
    raise exception 'Invalid push event' using errcode='22023';
  end if;
  return query select d.id,d.fcm_token,d.locale from public.push_devices d
    join public.tenant_users tu on tu.tenant_id=d.tenant_id and tu.user_id=d.user_id
    join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
    join auth.users u on u.id=d.user_id
    left join public.push_notification_preferences p on p.tenant_id=d.tenant_id and p.user_id=d.user_id
    where d.tenant_id=p_tenant_id and d.enabled and tu.role in ('owner','admin')
      and (p_exclude_user_id is null or d.user_id<>p_exclude_user_id)
      and (s.not_after is null or s.not_after>now())
      and (u.banned_until is null or u.banned_until<=now()) and not coalesce(u.is_anonymous,false)
      and case p_event when 'new_order' then coalesce(p.new_order,true)
        when 'signup_request' then coalesce(p.signup_request,true)
        when 'low_stock' then coalesce(p.low_stock,true) else coalesce(p.order_status,false) end
      and (p_after_id is null or d.id>p_after_id) order by d.id limit 100;
end; $$;
revoke all on function public.push_event_recipients(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.push_event_recipients(uuid,text,uuid,uuid) to service_role;

create or replace function public.new_order_push_recipients(p_order_id uuid,p_after_id uuid default null)
returns table(device_id uuid,fcm_token text,locale text)
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid;
begin
  perform public.assert_service_role('new_order_push_recipients');
  select o.tenant_id into v_tenant from public.orders o
    join public.push_order_dispatches d on d.order_id=o.id where o.id=p_order_id;
  if not found then return; end if;
  return query select * from public.push_event_recipients(v_tenant,'new_order',null,p_after_id);
end; $$;

create table public.push_event_dispatches (
  event_type text not null check(event_type in ('signup_request','order_status')),
  source_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key(event_type,source_id)
);
alter table public.push_event_dispatches enable row level security;
revoke all on public.push_event_dispatches from public,anon,authenticated;
grant select on public.push_event_dispatches to service_role;

create function public.claim_signup_request_push(p_request_id uuid)
returns table(tenant_id uuid,store_name text)
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid; v_name text;
begin
  perform public.assert_service_role('claim_signup_request_push');
  select r.tenant_id,r.name into v_tenant,v_name from public.customer_signup_requests r
    where r.id=p_request_id and r.created_at>=now()-interval '15 minutes';
  if not found then return; end if;
  insert into public.push_event_dispatches(event_type,source_id) values('signup_request',p_request_id) on conflict do nothing;
  if not found then return; end if;
  return query select v_tenant,v_name;
end; $$;
revoke all on function public.claim_signup_request_push(uuid) from public,anon,authenticated;
grant execute on function public.claim_signup_request_push(uuid) to service_role;

-- Exact committed transition, never a latest-row guess. Actor comes from history.
create function public.claim_order_status_push(p_order_id uuid,p_old_status public.order_status,p_new_status public.order_status)
returns table(tenant_id uuid,actor_id uuid,order_number text,new_status public.order_status)
language plpgsql security definer set search_path='' as $$
declare v_history public.order_status_history%rowtype; v_number text;
begin
  perform public.assert_service_role('claim_order_status_push');
  if p_old_status is null or p_new_status is null or p_old_status=p_new_status then return; end if;
  select h.* into v_history from public.order_status_history h where h.order_id=p_order_id
    and h.old_status=p_old_status and h.new_status=p_new_status and h.created_at>=now()-interval '15 minutes';
  if not found then return; end if;
  select o.order_number into v_number from public.orders o where o.id=p_order_id and o.tenant_id=v_history.tenant_id;
  insert into public.push_event_dispatches(event_type,source_id) values('order_status',v_history.id) on conflict do nothing;
  if not found then return; end if;
  return query select v_history.tenant_id,v_history.changed_by,v_number,v_history.new_status;
end; $$;
revoke all on function public.claim_order_status_push(uuid,public.order_status,public.order_status) from public,anon,authenticated;
grant execute on function public.claim_order_status_push(uuid,public.order_status,public.order_status) to service_role;

create table public.push_low_stock_state (
  tenant_id uuid not null, product_id uuid not null,
  is_low boolean not null, generation bigint not null default 0 check(generation>=0),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,product_id),
  foreign key(tenant_id,product_id) references public.inventory_items(tenant_id,product_id) on delete cascade
);
create table public.push_low_stock_crossings (
  tenant_id uuid not null, product_id uuid not null, generation bigint not null,
  quantity integer not null, crossed_at timestamptz not null default now(), claimed_at timestamptz,
  primary key(tenant_id,product_id,generation),
  foreign key(tenant_id,product_id) references public.push_low_stock_state(tenant_id,product_id) on delete cascade
);
create index push_low_stock_pending_idx on public.push_low_stock_crossings(tenant_id,product_id) where claimed_at is null;
alter table public.push_low_stock_state enable row level security;
alter table public.push_low_stock_crossings enable row level security;
revoke all on public.push_low_stock_state,public.push_low_stock_crossings from public,anon,authenticated;
grant select on public.push_low_stock_state,public.push_low_stock_crossings to service_role;

-- Existing and newly tracked inventory establishes a baseline, not an alert.
-- OLD/NEW capture keeps rapid recovery + recrossing even when after() runs late.
insert into public.push_low_stock_state(tenant_id,product_id,is_low)
  select tenant_id,product_id,quantity_available<=low_stock_threshold from public.inventory_items;
create function public.capture_push_low_stock() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_cross boolean := false; v_generation bigint;
begin
  if TG_OP='UPDATE' then
    v_cross := OLD.quantity_available>OLD.low_stock_threshold and NEW.quantity_available<=NEW.low_stock_threshold;
  end if;
  insert into public.push_low_stock_state(tenant_id,product_id,is_low,generation)
    values(NEW.tenant_id,NEW.product_id,NEW.quantity_available<=NEW.low_stock_threshold,case when v_cross then 1 else 0 end)
    on conflict(tenant_id,product_id) do update set is_low=excluded.is_low,
      generation=public.push_low_stock_state.generation + case when v_cross then 1 else 0 end,updated_at=now()
    returning generation into v_generation;
  if v_cross then
    insert into public.push_low_stock_crossings(tenant_id,product_id,generation,quantity)
      values(NEW.tenant_id,NEW.product_id,v_generation,NEW.quantity_available);
  end if;
  return NEW;
exception when others then
  -- Notification bookkeeping is fail-open; never log SQLERRM or business fields.
  raise warning 'push low-stock capture unavailable';
  return NEW;
end; $$;
revoke all on function public.capture_push_low_stock() from public,anon,authenticated;
create trigger inventory_push_low_stock after insert or update of quantity_available,low_stock_threshold on public.inventory_items
  for each row execute function public.capture_push_low_stock();

-- Lock authoritative inventory first, same order as all business writers. Captured
-- generations dedupe independently: delayed callbacks cannot collapse crossings.
create function public.claim_low_stock_push(p_tenant_id uuid,p_product_id uuid)
returns table(generation bigint,quantity integer,name_ar text,name_he text,name_en text)
language plpgsql security definer set search_path='' as $$
declare v_inv public.inventory_items%rowtype;
begin
  perform public.assert_service_role('claim_low_stock_push');
  select i.* into v_inv from public.inventory_items i where i.tenant_id=p_tenant_id and i.product_id=p_product_id for update;
  if not found then return; end if;
  insert into public.push_low_stock_state(tenant_id,product_id,is_low)
    values(p_tenant_id,p_product_id,v_inv.quantity_available<=v_inv.low_stock_threshold)
    on conflict(tenant_id,product_id) do update set is_low=excluded.is_low,updated_at=now();
  return query with claimed as (
    update public.push_low_stock_crossings c set claimed_at=now()
      where c.tenant_id=p_tenant_id and c.product_id=p_product_id and c.claimed_at is null
      returning c.generation,c.quantity,c.crossed_at
  ) select c.generation,v_inv.quantity_available,p.name_ar,p.name_he,p.name_en from claimed c
    join public.products p on p.id=p_product_id and p.tenant_id=p_tenant_id
    where c.crossed_at>=now()-interval '15 minutes'
      and v_inv.quantity_available<=v_inv.low_stock_threshold order by c.generation;
end; $$;
revoke all on function public.claim_low_stock_push(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_low_stock_push(uuid,uuid) to service_role;

-- Include removed order lines: their reservation ledger records restored stock.
create function public.push_inventory_products_for_order(p_order_id uuid)
returns table(tenant_id uuid,product_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_service_role('push_inventory_products_for_order');
  return query select o.tenant_id,i.product_id from public.orders o join public.order_items i
    on i.order_id=o.id and i.tenant_id=o.tenant_id where o.id=p_order_id
    union select o.tenant_id,m.product_id from public.orders o join public.order_inventory_movements m
    on m.order_id=o.id and m.tenant_id=o.tenant_id where o.id=p_order_id;
end; $$;
revoke all on function public.push_inventory_products_for_order(uuid) from public,anon,authenticated;
grant execute on function public.push_inventory_products_for_order(uuid) to service_role;

-- V2 returns only the exact inserted UUID. The browser action still returns boolean.
create or replace function public.submit_customer_signup_request_v2(
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
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_link uuid;
  v_request uuid;
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
     nullif(trim(coalesce(p_notes, '')), '')) returning id into v_request;

  update public.customer_signup_links set last_used_at = now() where id = v_link;
  return v_request;
end;
$$;
revoke all on function public.submit_customer_signup_request_v2(
  text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_customer_signup_request_v2(
  text, text, text, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

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
returns boolean language sql volatile security definer set search_path='' as $$
  select case when public.submit_customer_signup_request_v2(p_token,p_name,p_contact_name,p_phone,p_email,
    p_city_ar,p_city_he,p_city_en,p_address,p_notes) is not null then true else null end;
$$;
