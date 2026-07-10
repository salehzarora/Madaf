-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M8A.2 — backfill customer-facing document numbers to public_ref
--
-- M7G (20260718100000) switched NEW document numbering to the random
-- per-order public_ref ('DOC-XXXXXXXX-<O|D|I>') but never backfilled rows
-- created before it — pre-M7G / seeded documents still carry numbers derived
-- from the INTERNAL sequential warehouse number ('DOC-1042-I'), which is
-- exactly the leak M7G closed. This backfills them.
--
-- Stored-PDF staleness: a previously stored PDF (storage_path set) was
-- rendered with the OLD leaking number baked into the file. Serving it after
-- the backfill would still leak, so for CHANGED rows we clear
-- storage_path / generated_at / file_size_bytes / checksum — the next
-- download regenerates (and re-stores) the PDF with the correct number. The
-- storage objects become orphans in the private, server-trusted `documents`
-- bucket (unreadable by clients); acceptable garbage, no data loss.
--
-- The suffix (-O / -D / -I) is re-derived from document_type, not parsed from
-- the old number. Rows already on the public_ref scheme are untouched
-- (WHERE guards on the old internal-derived prefix).
--
-- No legal change: documents remain DRAFTS; notices/watermarks untouched.
-- Local stack only; apply to hosted staging with `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════

with renumbered as (
  select d.id,
         'DOC-' || replace(o.public_ref, 'MDF-', '') ||
         case d.document_type
           when 'order_request' then '-O'
           when 'delivery_note' then '-D'
           when 'invoice_draft' then '-I'
         end as new_number
  from public.documents d
  join public.orders o on o.id = d.order_id
  -- Only rows still on the internal-sequence scheme:
  --   old: DOC-<digits>-<suffix>   new: DOC-<8 base32 chars>-<suffix>
  where d.document_number ~ '^DOC-[0-9]+-[ODI]$'
    and o.public_ref is not null
)
update public.documents d
   set document_number = r.new_number,
       storage_path    = null,
       generated_at    = null,
       file_size_bytes = null,
       checksum        = null
  from renumbered r
 where d.id = r.id
   and d.document_number is distinct from r.new_number;
