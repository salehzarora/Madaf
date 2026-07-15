-- ═══════════════════════════════════════════════════════════════════════
-- C2 — Concurrency-safe signup review terminal transitions
--
-- FIX for a confirmed P2 data-integrity race in approve_customer_signup_request.
-- The prior approval RPC read the request state WITHOUT a lock, checked "pending"
-- in plpgsql, created the Customer, then ran an UNCONDITIONAL
--   update ... set approved_at = now() where id = p_request_id
-- with no pending predicate. So a concurrent reject (or a second approve) could
-- interleave between the read and the final write, leaving the SAME request with
--   approved_at IS NOT NULL AND rejected_at IS NOT NULL
-- and/or creating a Customer after a rejection, or two Customers / two
-- customer.created audit events under concurrent approvals.
--
-- The signup-request state machine has exactly three valid states:
--   PENDING   approved_at IS NULL     AND rejected_at IS NULL
--   APPROVED  approved_at IS NOT NULL AND rejected_at IS NULL
--   REJECTED  approved_at IS NULL     AND rejected_at IS NOT NULL
-- Only ONE terminal transition (approve OR reject) may win for a request; the
-- BOTH-set state must never be reachable.
--
-- ARCHITECTURE (approach A — row lock, with an approach-B conditional claim as
-- defense-in-depth):
--   • approve now locks the exact tenant-scoped request row with SELECT ... FOR
--     UPDATE, then RE-CHECKS pending WHILE HOLDING THE LOCK, BEFORE creating the
--     Customer. Under READ COMMITTED a lock wait re-reads the latest committed
--     row (EvalPlanQual), so a terminal transition that won the race is seen and
--     the losing approve raises BEFORE any Customer / audit event is written. The
--     Customer insert, the request transition and the audit insert are one
--     transaction — all commit together or none do.
--   • reject is UNCHANGED: it is already an atomic conditional claim
--     (UPDATE ... WHERE approved_at IS NULL AND rejected_at IS NULL), which
--     transitions PENDING → REJECTED only and, against an approve holding the row
--     lock, blocks then re-evaluates its predicate and fails safely if approval
--     won. Both terminal transitions therefore obey the same pending predicate.
--
-- DEFENSE-IN-DEPTH: a CHECK constraint makes the BOTH-set state unreachable at
-- the storage layer regardless of any future code path. It is safe against every
-- current writer (submit inserts a both-NULL pending row; approve sets only
-- approved_at from pending; reject sets only rejected_at from pending), so no
-- existing/expected row violates it.
--
-- Additive only: one CREATE OR REPLACE of an existing SECURITY DEFINER RPC
-- (identical signature / security mode / search_path / authorization / grants /
-- business result and audit event — ONLY the locking + conditional claim added)
-- and one CHECK constraint. No table rewrite, no data change, no grant change,
-- no signature change (generated TS types unaffected). reject RPC untouched.
-- ═══════════════════════════════════════════════════════════════════════

-- ── approve_customer_signup_request — lock + re-check pending + conditional claim
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
  -- + the safe request id), in the SAME transaction as the mutation.
  perform public._log_customer_audit_event(
    v_tenant, 'customer.created', v_customer_id,
    jsonb_build_object('origin', 'signup', 'signup_request_id', p_request_id));
  return v_customer_id;
end;
$$;

revoke all on function public.approve_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.approve_customer_signup_request(uuid, uuid) to authenticated, service_role;

-- ── Storage-layer invariant: a request can never be BOTH approved and rejected.
-- Safe against every current writer (submit → both NULL; approve → approved only;
-- reject → rejected only), so no existing/expected row violates it. Encodes the
-- state machine so the contradictory terminal state is unreachable even if a
-- future code path regressed.
--
-- Added NOT VALID BY DESIGN: the CHECK is enforced for every future INSERT/UPDATE
-- (which is the entire point — the RPC fix already prevents the race, this is
-- belt-and-braces), but the ALTER does NOT scan pre-existing rows, so the apply
-- can never fail on legacy data. This is the deploy-safe choice because hosted
-- data cannot be inspected from here (local-only workflow); if a preflight
-- confirms zero (approved_at IS NOT NULL AND rejected_at IS NOT NULL) rows, the
-- constraint can be promoted with `VALIDATE CONSTRAINT` in a later migration.
-- Local `supabase db reset` applies it to an empty table, so validated and
-- NOT VALID are behaviourally identical locally (both reject a BOTH-set write).
alter table public.customer_signup_requests
  add constraint customer_signup_requests_terminal_state_ck
  check (approved_at is null or rejected_at is null) not valid;
