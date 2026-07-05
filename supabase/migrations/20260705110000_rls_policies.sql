-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M1 — Row Level Security
--
-- Posture: deny by default.
-- - RLS is enabled on every table; a row is only reachable through an
--   explicit policy.
-- - `anon` gets NO grants and NO policies: the public mock UI never touches
--   the database (it runs on src/lib/mock/* via NEXT_PUBLIC_MADAF_DATA_MODE
--   =mock), so real tenant data is never exposed publicly.
-- - `authenticated` users only reach rows of tenants they are members of
--   (tenant_users), via the security-definer helpers below.
--
-- TEMPORARY / FUTURE (M4 — auth milestone):
-- - Sales reps currently read ALL tenant rows like admins. M4 narrows
--   order visibility to rows they created and scopes the shop picker.
-- - Shop owners (tokenized remote ordering links) are not modeled yet;
--   they will get customer-scoped policies of their own in M4.
-- - Tenant onboarding (insert into tenants + first owner membership) is
--   service-role only for now — there is deliberately no INSERT policy on
--   tenants/tenant_users for regular users.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Helper functions ─────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on tenant_users itself (and every other
-- table) can consult memberships without recursive RLS evaluation.
-- search_path is pinned empty; all references are schema-qualified.

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
  );
$$;

comment on function public.is_tenant_member(uuid) is
  'True when the calling authenticated user is a member (any role) of the tenant.';

create or replace function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
      and tu.role = any (p_roles)
  );
$$;

comment on function public.has_tenant_role(uuid, public.tenant_role[]) is
  'True when the calling authenticated user has one of the given roles in the tenant.';

revoke all on function public.is_tenant_member(uuid) from public, anon;
revoke all on function public.has_tenant_role(uuid, public.tenant_role[]) from public, anon;
grant execute on function public.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function public.has_tenant_role(uuid, public.tenant_role[]) to authenticated, service_role;

-- ── next_order_number ────────────────────────────────────────────────────
-- Concurrency-safe human order number: MDF-1048, MDF-1049, … The row
-- update takes a lock, so two simultaneous checkouts cannot get the same
-- number. SECURITY DEFINER on purpose: ANY tenant member may draw a
-- number when creating an order, but under RLS only owners/admins can
-- UPDATE tenants — so the membership gate below is the real access check.

create or replace function public.next_order_number(p_tenant_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  -- Members draw numbers for their own tenant; service-role callers
  -- (trusted server scripts) are exempt from the membership check.
  if not (
    public.is_tenant_member(p_tenant_id)
    or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
  ) then
    raise exception 'next_order_number: not a member of tenant %', p_tenant_id
      using errcode = '42501'; -- insufficient_privilege
  end if;
  update public.tenants
     set order_seq = order_seq + 1
   where id = p_tenant_id
  returning 'MDF-' || order_seq::text into v_number;
  return v_number;
end;
$$;

comment on function public.next_order_number(uuid) is
  'Draws the next human order number (MDF-####) for a tenant. Members only; atomic via row lock on tenants.';

revoke all on function public.next_order_number(uuid) from public, anon;
grant execute on function public.next_order_number(uuid) to authenticated, service_role;

-- ── Grants ───────────────────────────────────────────────────────────────
-- Newer Supabase defaults do not auto-expose new tables through the Data
-- API; we grant explicitly — to `authenticated` and `service_role` only.
-- `anon` deliberately gets nothing.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on
  public.tenants,
  public.tenant_users,
  public.customers,
  public.manufacturers,
  public.categories,
  public.products,
  public.inventory_items,
  public.orders,
  public.order_items,
  public.order_status_history,
  public.documents,
  public.audit_events
to authenticated, service_role;

-- audit_events uses an identity column.
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Belt & braces: make sure anon has nothing, even if defaults change.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ── Enable RLS everywhere ────────────────────────────────────────────────

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.customers enable row level security;
alter table public.manufacturers enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.documents enable row level security;
alter table public.audit_events enable row level security;

-- ── tenants ──────────────────────────────────────────────────────────────
-- Read: any member. Update: owner/admin. No insert/delete policy —
-- onboarding and offboarding run through the service role until M4.

create policy "tenants: members can read their tenant"
  on public.tenants for select to authenticated
  using (public.is_tenant_member(id));

create policy "tenants: owners/admins can update their tenant"
  on public.tenants for update to authenticated
  using (public.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]));

-- ── tenant_users ─────────────────────────────────────────────────────────
-- Users always see their own memberships; owners/admins see and manage the
-- whole roster. The helpers are SECURITY DEFINER, so these policies do not
-- recurse into themselves.
--
-- Escalation guard: only OWNERS may create/modify/remove owner rows.
-- Admins manage non-owner members but can neither touch an owner row
-- (USING excludes them) nor grant the owner role (WITH CHECK excludes
-- it) — otherwise an admin could simply promote themselves.
-- (Preventing a tenant from losing its last owner is an M4 concern.)

create policy "tenant_users: users can read their own memberships"
  on public.tenant_users for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
  );

create policy "tenant_users: owners/admins can add members"
  on public.tenant_users for insert to authenticated
  with check (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  );

create policy "tenant_users: owners/admins can change roles"
  on public.tenant_users for update to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  )
  with check (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  );

create policy "tenant_users: owners/admins can remove members"
  on public.tenant_users for delete to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  );

-- ── Master data: customers / manufacturers / categories / products /
--    inventory_items ──────────────────────────────────────────────────────
-- Members read and write day-to-day; destructive deletes are owner/admin.

create policy "customers: members can read"
  on public.customers for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "customers: members can insert"
  on public.customers for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "customers: members can update"
  on public.customers for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "customers: owners/admins can delete"
  on public.customers for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "manufacturers: members can read"
  on public.manufacturers for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "manufacturers: members can insert"
  on public.manufacturers for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "manufacturers: members can update"
  on public.manufacturers for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "manufacturers: owners/admins can delete"
  on public.manufacturers for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "categories: members can read"
  on public.categories for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "categories: members can insert"
  on public.categories for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "categories: members can update"
  on public.categories for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "categories: owners/admins can delete"
  on public.categories for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "products: members can read"
  on public.products for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "products: members can insert"
  on public.products for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "products: members can update"
  on public.products for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "products: owners/admins can delete"
  on public.products for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "inventory_items: members can read"
  on public.inventory_items for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "inventory_items: members can insert"
  on public.inventory_items for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "inventory_items: members can update"
  on public.inventory_items for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "inventory_items: owners/admins can delete"
  on public.inventory_items for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── orders & order_items ─────────────────────────────────────────────────
-- Members run the order flow end to end (create, edit lines, move status).
-- ⚠️ There is deliberately NO delete policy on orders: hard-deleting an
-- order would cascade into order_items and order_status_history and
-- collide with the never-delete rule on documents — cancelling
-- (status = 'cancelled') is the only removal path through the API.
-- M4 will narrow sales reps to orders they created.

create policy "orders: members can read"
  on public.orders for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "orders: members can insert"
  on public.orders for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "orders: members can update"
  on public.orders for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "order_items: members can read"
  on public.order_items for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "order_items: members can insert"
  on public.order_items for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "order_items: members can update"
  on public.order_items for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "order_items: members can delete"
  on public.order_items for delete to authenticated
  using (public.is_tenant_member(tenant_id));

-- ── order_status_history ─────────────────────────────────────────────────
-- Trigger-only writes: log_order_status_change is SECURITY DEFINER and
-- runs as the table owner, which is not subject to these policies — so
-- history needs NO insert policy at all. Deliberately none exists:
-- members cannot forge history rows (arbitrary changed_by / transitions),
-- and no update/delete policies means history is immutable via the API.

create policy "order_status_history: members can read"
  on public.order_status_history for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- ── documents ────────────────────────────────────────────────────────────
-- ⚠️ LEGAL: no delete policy on purpose — documents are voided (status),
-- never removed. Only owner/admin may update (e.g. void); nobody can strip
-- the legal notice off an invoice draft thanks to the table CHECK.

create policy "documents: members can read"
  on public.documents for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "documents: members can insert"
  on public.documents for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "documents: owners/admins can update"
  on public.documents for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── audit_events ─────────────────────────────────────────────────────────
-- Append-only. No update/delete policies — the trail is immutable
-- through the API. Inserts must be attributed honestly: actor_user_id is
-- either the caller or null (system events go through the service role).

create policy "audit_events: members can read"
  on public.audit_events for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "audit_events: members can insert as themselves"
  on public.audit_events for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (actor_user_id is null or actor_user_id = (select auth.uid()))
  );
