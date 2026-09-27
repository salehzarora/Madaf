import type { ReactNode } from "react";

/** Bounded Admin analytics surface; global Card defaults remain Ledger. */
export function AnalyticsCard({ title, titleId, context, children }: {
  title: string;
  titleId: string;
  context?: string;
  children: ReactNode;
}) {
  return (
    <section className="dashboard-analytics-card" aria-labelledby={titleId}>
      <header className="dashboard-analytics-header">
        <h2 id={titleId}>{title}</h2>
        {context ? <p>{context}</p> : null}
      </header>
      <div className="dashboard-analytics-body">{children}</div>
    </section>
  );
}
