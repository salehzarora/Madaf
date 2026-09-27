"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { Dictionary } from "@/i18n/types";
import type { DashboardRangeKey } from "@/lib/dashboard-range";

/** Tiny form leaf only. Native GET navigation makes every filtered metric a
 * fresh server render; no aggregates or client timezone calculations live here. */
export function DashboardRangeControl({ action, range, from, to, today, labels, invalid }: {
  action: string; range: DashboardRangeKey; from: string; to: string; today: string;
  labels: Dictionary["admin"]["dashboard"]["range"]; invalid: boolean;
}) {
  const [selected, setSelected] = useState(range);
  return <form action={action} method="get" className="dashboard-range-form">
    <div className="dashboard-range-main">
      <label htmlFor="dashboard-range"><CalendarDays aria-hidden />{labels.label}</label>
      <select id="dashboard-range" name="range" value={selected} onChange={event => setSelected(event.target.value as DashboardRangeKey)}>
        {Object.entries(labels.presets).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button type="submit" className="dashboard-action dashboard-action-primary">{labels.apply}</button>
    </div>
    {selected === "custom" ? <div className="dashboard-custom-range">
      <label>{labels.from}<input name="from" type="date" defaultValue={from} max={today} required dir="ltr" /></label>
      <label>{labels.to}<input name="to" type="date" defaultValue={to} max={today} required dir="ltr" /></label>
      <p>{labels.customHint}</p>
    </div> : null}
    {invalid ? <p role="status" className="dashboard-range-error">{labels.invalid}</p> : null}
  </form>;
}
