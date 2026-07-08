/**
 * Admin route loading fallback (M7D.3) — perceived-responsiveness only.
 *
 * Shown in the main content area while a dynamic/authenticated admin page
 * renders on the server (each navigation does its Supabase round-trips). The
 * AdminShell (sidebar + top bar) persists around this via the layout, so only
 * the content shows a skeleton. No data fetch, no client JS, no secrets;
 * RTL-safe (logical utilities / symmetric grid only).
 */
export default function AdminLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-5"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Title block */}
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 animate-pulse rounded-full bg-line" />
        <div className="h-7 w-56 animate-pulse rounded-md bg-line" />
      </div>

      {/* KPI / card row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-line bg-surface"
          />
        ))}
      </div>

      {/* Content rows */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-surface-sunken" />
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
