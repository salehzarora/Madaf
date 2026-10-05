-- SECURITY-GRANTS-CLOSURE-001: restore the intended RPC-only mutation boundary.
-- No policies, data, function bodies, intentional APIs or service capabilities change.
-- Hosted inspection: all application tables/sequences are owned by postgres.

-- These four relations are read-only for authenticated clients. Mutation is
-- performed by owner-executed SECURITY DEFINER RPCs and attached triggers.
revoke all privileges on table
  public.audit_events, public.order_status_history, public.documents, public.tenants
  from public, anon, authenticated;
grant select on table
  public.audit_events, public.order_status_history, public.documents, public.tenants
  to authenticated;

-- Identity allocation belongs to trusted writers, never to API clients.
revoke all privileges on sequence
  public.audit_events_id_seq, public.token_access_attempts_id_seq,
  public.legal_document_events_id_seq
  from public, anon, authenticated;

-- Internal helpers: no direct API caller is required. Existing triggers,
-- postgres ownership and service_role EXECUTE remain intact. Explicitly retain
-- service access even on local installs that previously inherited only PUBLIC.
grant execute on function
  public.log_order_status_change(),
  public._gen_order_public_ref(),
  public._orders_set_public_ref(),
  public.set_updated_at(),
  public._legal_documents_guard_immutable(),
  public._sandbox_writeonce_guard()
  to service_role;
revoke execute on function
  public.log_order_status_change(),
  public._gen_order_public_ref(),
  public._orders_set_public_ref(),
  public.set_updated_at(),
  public._legal_documents_guard_immutable(),
  public._sandbox_writeonce_guard()
  from public, anon, authenticated;

-- Supabase's initial-schema defaults grant ALL on future public objects to
-- anon/authenticated. Application migrations create objects as postgres:
-- future exposure must now be granted explicitly, with its RLS/API boundary.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- PostgreSQL's implicit PUBLIC EXECUTE is global, so a schema-only revoke
-- cannot remove it. This affects only FUTURE postgres-owned functions; existing
-- authenticated and intentional token/shop/showcase/signup APIs are unchanged.
alter default privileges for role postgres
  revoke execute on functions from public;

-- supabase_admin's separate vendor-owned defaults are NOT altered: the hosted
-- postgres migration role cannot administer that role, and no application
-- table/sequence is owned by it. See the scoped deferred finding in the review.
