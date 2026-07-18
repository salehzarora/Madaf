-- ═══════════════════════════════════════════════════════════════════════
-- PILOT-OPS-AUDIT-006 — CUSTOMER SIGNUP REQUEST DECISION AUDIT (M8I.6)
--
-- Records the owner/admin REVIEW DECISION on a tenant-scoped customer/store
-- signup request. These are Customer/store signup requests INSIDE an existing
-- tenant (an anonymous applicant submits through a tokenized link; the tenant's
-- owner/admin reviews). Approval creates one public.customers row (NOT a Tenant
-- or owner membership); rejection creates no Customer. There is NO platform
-- signup / Tenant provisioning here — create_tenant_with_owner is a separate
-- self-service path and is untouched.
--
-- WHAT IS AUDITED (closed 2-event vocabulary, entity_type='customer_signup_request',
-- entity_id = the request id):
--   customer_signup_request.approved — approve transitions PENDING → APPROVED.
--   customer_signup_request.rejected — reject transitions PENDING → REJECTED.
-- Submission is NOT audited (anonymous submitter → null actor; the request row is
-- itself the submission record). Approval ALSO keeps its existing
-- customer.created(origin=signup) event — that is a Customer-lifecycle fact on a
-- different entity and is preserved verbatim, not replaced.
--
-- METADATA is EXACTLY {business_name[, resulting_customer_id]}: the bounded
-- request name snapshot (owner/admin-only) + (approved only) the created Customer
-- id (never rendered raw). NO applicant email/phone/address/notes/contact, no
-- token/JWT/session/secret, no reason (there is no rejection-reason column).
--
-- CONCURRENCY is UNCHANGED: the C2 approve row-lock + pending re-check +
-- conditional claim and the reject atomic conditional claim are preserved; the
-- new events are emitted transactionally and change-gated so only the WINNING
-- terminal transition writes an event. The terminal-state CHECK is untouched.
--
-- ADDITIVE: one private helper + a redefinition of the two review RPCs
-- (signatures / return types / DEFINER / search_path / grants / authorization /
-- C2 locking / error contracts / customer.created PRESERVED) + one additive
-- customer_signup_request clause on the audit_events SELECT policy + one partial
-- index. No table/column creation (except the index), no data mutation, no
-- backfill, no historical event.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Private Customer-signup-request audit helper ────────────────────────
-- SECURITY INVOKER (like the customer/team/settings/assignment helpers): callable
-- only from the SECURITY DEFINER review RPCs; revoked from every client role.
-- Closed 2-event allowlist, entity_type='customer_signup_request', actor
-- auth.uid(), entity_id = the request id. STRICT metadata: approved requires
-- EXACTLY {business_name, resulting_customer_id}; rejected requires EXACTLY
-- {business_name}. business_name is trimmed/non-empty/≤200; resulting_customer_id
-- (approved only) is a valid UUID. Any missing/unknown/oversized value is rejected.
create function public._log_customer_signup_request_audit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_business_name text;
  v_customer_id text;
begin
  if p_tenant_id is null then
    raise exception '_log_customer_signup_request_audit_event: tenant is required' using errcode = '22023';
  end if;
  if p_entity_id is null then
    raise exception '_log_customer_signup_request_audit_event: entity id (request) is required' using errcode = '22023';
  end if;
  if p_event_type not in ('customer_signup_request.approved', 'customer_signup_request.rejected') then
    raise exception '_log_customer_signup_request_audit_event: unknown event type %', p_event_type using errcode = '22023';
  end if;
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception '_log_customer_signup_request_audit_event: metadata must be a JSON object' using errcode = '22023';
  end if;
  if length(v_meta::text) > 4000 then
    raise exception '_log_customer_signup_request_audit_event: metadata exceeds the size bound' using errcode = '22023';
  end if;

  -- business_name: required for both events; trimmed, non-empty, bounded.
  if jsonb_typeof(v_meta -> 'business_name') <> 'string' then
    raise exception '_log_customer_signup_request_audit_event: business_name must be a string' using errcode = '22023';
  end if;
  v_business_name := v_meta ->> 'business_name';
  if v_business_name is null or char_length(btrim(v_business_name)) = 0 or char_length(v_business_name) > 200
     or v_business_name <> btrim(v_business_name) then
    raise exception '_log_customer_signup_request_audit_event: business_name must be trimmed and 1..200 chars'
      using errcode = '22023';
  end if;

  if p_event_type = 'customer_signup_request.approved' then
    -- EXACTLY business_name + resulting_customer_id (no missing, no extras).
    if (select count(*) from jsonb_object_keys(v_meta)) <> 2 or not (v_meta ? 'resulting_customer_id') then
      raise exception '_log_customer_signup_request_audit_event: approved metadata must contain exactly business_name and resulting_customer_id'
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_meta -> 'resulting_customer_id') <> 'string' then
      raise exception '_log_customer_signup_request_audit_event: resulting_customer_id must be a string' using errcode = '22023';
    end if;
    v_customer_id := v_meta ->> 'resulting_customer_id';
    begin
      perform v_customer_id::uuid;
    exception when invalid_text_representation then
      raise exception '_log_customer_signup_request_audit_event: resulting_customer_id must be a UUID' using errcode = '22023';
    end;
  else
    -- rejected: EXACTLY business_name (resulting_customer_id must be absent).
    if (select count(*) from jsonb_object_keys(v_meta)) <> 1 then
      raise exception '_log_customer_signup_request_audit_event: rejected metadata must contain exactly business_name'
        using errcode = '22023';
    end if;
  end if;

  insert into public.audit_events
    (tenant_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values
    (p_tenant_id, (select auth.uid()), p_event_type, 'customer_signup_request', p_entity_id, v_meta);
end;
$$;

comment on function public._log_customer_signup_request_audit_event(uuid, text, uuid, jsonb) is
  'M8I.6 — PRIVATE transactional Customer-signup-request decision audit producer. Closed 2-event '
  'allowlist (customer_signup_request.approved / rejected), entity_type=customer_signup_request, '
  'entity_id=request_id, actor=auth.uid(). Metadata is EXACTLY {business_name} for rejected and '
  '{business_name, resulting_customer_id} for approved (business_name trimmed 1..200; '
  'resulting_customer_id a UUID). Callable only from the review RPCs.';

revoke all on function public._log_customer_signup_request_audit_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ── 2. approve_customer_signup_request — C2 preserved + approved event ──────
-- Base: 20260805100000 (C2). The row lock, pending re-check, Customer insert
-- (origin=signup), conditional terminal claim, and customer.created event are
-- PRESERVED verbatim; ONE customer_signup_request.approved is emitted after the
-- winning claim, in the SAME transaction. business_name is the locked request
-- name; resulting_customer_id is the created Customer.
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
  v_claimed integer;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  -- Lock the target request row so concurrent approve/reject of the SAME request
  -- serialize here. A concurrent terminal transition that commits first is seen
  -- by the re-check below (the FOR UPDATE wait re-reads the latest row version).
  select * into v_req
  from public.customer_signup_requests r
  where r.id = p_request_id and r.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'approve_customer_signup_request: request unknown or another tenant'
      using errcode = '22023';
  end if;

  -- Terminal-state gate under the lock: only a still-PENDING request may be
  -- approved. Evaluated BEFORE the Customer insert, so a losing approval commits
  -- no Customer and no audit event.
  if v_req.approved_at is not null or v_req.rejected_at is not null then
    raise exception 'approve_customer_signup_request: request already reviewed'
      using errcode = '22023';
  end if;

  v_notes := case
    when v_req.email is not null and v_req.email <> ''
      then trim(both e'\n' from coalesce(v_req.notes, '') || e'\nEmail: ' || v_req.email)
    else v_req.notes
  end;

  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
  values
    (v_tenant, v_req.name, v_req.contact_name, v_req.phone,
     v_req.city_ar, v_req.city_he, v_req.city_en, v_req.address, 'grocery', v_notes, 'signup')
  returning id into v_customer_id;

  -- Conditional terminal claim (defense-in-depth on top of the row lock): the
  -- pending predicate + a row-count assertion guarantee the request can only
  -- transition PENDING → APPROVED, exactly once. A 0-row result (impossible while
  -- the lock is held) rolls the whole RPC back — no Customer / audit survives.
  update public.customer_signup_requests
     set approved_at = now(),
         approved_customer_id = v_customer_id,
         reviewed_by = (select auth.uid())
   where id = p_request_id
     and approved_at is null
     and rejected_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed <> 1 then
    raise exception 'approve_customer_signup_request: request already reviewed'
      using errcode = '22023';
  end if;

  -- M8G.2: ONE customer.created event for the successful approval (origin signup
  -- + the safe request id), in the SAME transaction as the mutation. PRESERVED.
  perform public._log_customer_audit_event(
    v_tenant, 'customer.created', v_customer_id,
    jsonb_build_object('origin', 'signup', 'signup_request_id', p_request_id));

  -- M8I.6: ONE request-decision event for the approval (request entity), carrying
  -- the bounded business-name snapshot + the resulting Customer id.
  perform public._log_customer_signup_request_audit_event(
    v_tenant, 'customer_signup_request.approved', p_request_id,
    jsonb_build_object(
      'business_name', left(btrim(v_req.name), 200),
      'resulting_customer_id', v_customer_id));

  return v_customer_id;
end;
$$;

revoke all on function public.approve_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.approve_customer_signup_request(uuid, uuid) to authenticated, service_role;

-- ── 3. reject_customer_signup_request — atomic claim + rejected event ───────
-- Base: 20260719100000 (M7G) / C2-compatible. The atomic conditional claim
-- (PENDING-only) and the already-reviewed error contract are PRESERVED; the
-- request name is captured via RETURNING and change-gates ONE
-- customer_signup_request.rejected — no event on a 0-row (already-reviewed) claim.
create or replace function public.reject_customer_signup_request(
  p_tenant_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_name text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  update public.customer_signup_requests r
     set rejected_at = now(), reviewed_by = (select auth.uid())
   where r.id = p_request_id and r.tenant_id = v_tenant
     and r.approved_at is null and r.rejected_at is null
   returning r.name into v_name;
  if not found then
    raise exception 'reject_customer_signup_request: request unknown, another tenant, or already reviewed'
      using errcode = '22023';
  end if;

  -- M8I.6: ONE request-decision event for the rejection (change-gated by the
  -- RETURNING row), carrying only the bounded business-name snapshot.
  perform public._log_customer_signup_request_audit_event(
    v_tenant, 'customer_signup_request.rejected', p_request_id,
    jsonb_build_object('business_name', left(btrim(v_name), 200)));

  return p_request_id;
end;
$$;

revoke all on function public.reject_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.reject_customer_signup_request(uuid, uuid) to authenticated, service_role;

-- ── 4. audit_events SELECT policy — ADDITIVE customer_signup_request clause ─
-- The customer/order/product/inventory/team/settings/sales_rep_assignment clauses
-- are reproduced VERBATIM and a customer_signup_request clause is AND-ed on
-- (owner/admin only). Vacuous for other entity types; a customer_signup_request
-- row additionally requires owner/admin — a sales_rep / non-member / other tenant
-- sees none.
drop policy if exists "audit_events: members read; entity rows scoped" on public.audit_events;

create policy "audit_events: members read; entity rows scoped"
  on public.audit_events
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      entity_type <> 'customer'
      or public.can_access_customer(tenant_id, entity_id)
    )
    and (
      entity_type <> 'order'
      or (entity_id is not null and public.can_access_order(tenant_id, entity_id))
    )
    and (
      entity_type <> 'product'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'inventory'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'team'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'settings'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'sales_rep_assignment'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
    and (
      entity_type <> 'customer_signup_request'
      or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );

-- ── 5. Tenant-wide Customer-signup Activity index (PARTIAL) ─────────────────
-- Tenant-wide customer_signup_request stream. A partial index on (tenant_id,
-- created_at desc, id desc) WHERE entity_type='customer_signup_request' serves the
-- keyset read and, being partial, never competes for the per-entity audit reads.
-- No equivalent index exists.
create index audit_events_tenant_customer_signup_time_idx
  on public.audit_events (tenant_id, created_at desc, id desc)
  where entity_type = 'customer_signup_request';

comment on index public.audit_events_tenant_customer_signup_time_idx is
  'M8I.6 - partial index (entity_type=customer_signup_request) for the tenant-wide '
  'Customer Signup Activity read (created_at DESC, id DESC) as a keyset range scan; '
  'partial so it never competes for the per-entity audit timeline reads.';
