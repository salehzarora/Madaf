-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M3A.1 — force order writes through the validated RPCs
--
-- Codex review of M3A found that the M1.1 policies still let any
-- authenticated tenant member write orders/order_items DIRECTLY —
-- bypassing create_order_request()/update_order_status() and forging
-- order numbers, totals, price snapshots, or status jumps.
--
-- After this migration, for `authenticated` users:
--   orders        SELECT only — no INSERT/UPDATE/DELETE policy or grant
--   order_items   SELECT only — no INSERT/UPDATE/DELETE policy or grant
--
-- The ONLY write paths are the SECURITY DEFINER RPCs (which validate
-- everything and compute money server-side) plus the trusted service
-- role. History stays trigger-written; documents stay read-only.
--
-- M4 note: when authenticated flows arrive, grant EXECUTE on the RPCs
-- to authenticated and add in-function membership/role checks — do NOT
-- restore direct table writes.
-- ═══════════════════════════════════════════════════════════════════════

-- ── orders: drop direct-write policies (SELECT stays) ────────────────────
drop policy "orders: members can insert" on public.orders;
drop policy "orders: members can update" on public.orders;
-- (orders never had a DELETE policy — cancelling is the only removal path)

-- ── order_items: drop all direct-write policies (SELECT stays) ───────────
drop policy "order_items: members can insert" on public.order_items;
drop policy "order_items: members can update" on public.order_items;
drop policy "order_items: members can delete" on public.order_items;

-- ── grants mirror the policy matrix (defense in depth) ───────────────────
revoke insert, update, delete on public.orders from authenticated;
revoke insert, update, delete on public.order_items from authenticated;

-- Supabase's default ACL also hands `authenticated` TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN on new tables. TRUNCATE is RLS-EXEMPT — it would
-- empty a table across ALL tenants — and none of these privileges belong
-- to API roles. Strip them everywhere (anon already has nothing, but be
-- explicit for future-proofing).
revoke truncate, references, trigger, maintain
  on all tables in schema public
  from authenticated, anon;

-- next_order_number() was granted to authenticated in M1.1 for the
-- direct-insert order flow that this migration removes. Until M4 wires
-- authenticated RPC flows, members have no business drawing (burning)
-- order numbers — service role and the SECURITY DEFINER RPCs keep
-- working regardless.
revoke execute on function public.next_order_number(uuid) from authenticated;

comment on table public.orders is
  'Order requests. Writes go EXCLUSIVELY through create_order_request() / update_order_status() — authenticated users have read-only table access (M3A.1).';
comment on table public.order_items is
  'Snapshotted order lines. Written EXCLUSIVELY by create_order_request() — authenticated users have read-only table access (M3A.1).';
