#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# M8E.2 — reproducible LOCAL concurrency proof for replace_customer_access_link.
#
# Fires TWO overlapping replacements for the SAME customer against the disposable
# LOCAL Supabase database and asserts that exactly ONE active link remains — i.e.
# the per-customer `FOR UPDATE` lock (backed by the partial unique index)
# serializes concurrent replacements and never leaves two active links.
#
# LOCAL ONLY. Talks to the `supabase_db_*` Docker container over the local
# socket; there is no hosted fallback and no network credentials. It prints only
# counts/PASS/FAIL — never a raw token or secret (the two calls pass synthetic
# hashes, not real generated tokens). Repeatable after `supabase db reset`.
#
# Usage (local stack must be up: `supabase start`):
#   bash scripts/concurrency-replace-link.sh
# Expected: "PASS: exactly one active link after two concurrent replaces" (exit 0).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

TENANT='11111111-1111-4111-8111-111111111111'   # seeded demo tenant
CUSTOMER='cc000000-0000-4000-8000-000000000002'  # seeded demo customer
CLAIMS='{"role":"service_role"}'                 # authorize_tenant service_role path

CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'supabase_db' | head -1 || true)
if [ -z "${CONTAINER}" ]; then
  echo "FAIL: no local supabase_db_* container is running. Start it with: supabase start" >&2
  exit 2
fi

psql_run() { docker exec -i "${CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# Deterministic start: exactly one active link for the target customer.
psql_run -qc "
  begin;
    set local request.jwt.claims = '${CLAIMS}';
    delete from public.customer_access_links where customer_id = '${CUSTOMER}';
    select public.replace_customer_access_link('${TENANT}','${CUSTOMER}', repeat('0',64),'000000','seed', null);
  commit;" >/dev/null

# Session 1: hold the customer's FOR UPDATE lock ~2s, then replace + commit.
psql_run -qc "
  begin;
    set local request.jwt.claims = '${CLAIMS}';
    select public.replace_customer_access_link('${TENANT}','${CUSTOMER}', repeat('1',64),'111111','sess1', null);
    select pg_sleep(2);
  commit;" >/dev/null 2>&1 &
S1=$!

sleep 1  # ensure session 1 holds the lock before session 2 starts

# Session 2: starts DURING session 1's lock — must block on FOR UPDATE, then run.
psql_run -qc "
  begin;
    set local request.jwt.claims = '${CLAIMS}';
    select public.replace_customer_access_link('${TENANT}','${CUSTOMER}', repeat('2',64),'222222','sess2', null);
  commit;" >/dev/null 2>&1 &
S2=$!

wait "${S1}" "${S2}"

ACTIVE=$(psql_run -qtAc "select count(*) from public.customer_access_links where customer_id = '${CUSTOMER}' and revoked_at is null;")
ACTIVE=$(echo "${ACTIVE}" | tr -d '[:space:]')

echo "active links after two concurrent replaces: ${ACTIVE}"
if [ "${ACTIVE}" = "1" ]; then
  echo "PASS: exactly one active link after two concurrent replaces"
  exit 0
fi
echo "FAIL: expected exactly one active link, found ${ACTIVE}" >&2
exit 1
