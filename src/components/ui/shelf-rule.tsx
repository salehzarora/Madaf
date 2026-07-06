/**
 * Shelf-edge rule — the ledger motif under page titles, document headers, and
 * above document totals: a 2px ink line over a 1px hairline (a shelf edge).
 */
export function ShelfRule({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <div className="h-0.5 bg-ink" />
      <div className="h-[3px] border-b border-line-strong" />
    </div>
  );
}
