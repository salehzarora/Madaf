/**
 * Tiny CSV helpers (M8C) — no dependencies, admin-side exports only.
 *
 * Exports run CLIENT-side over rows the admin can already see (tenant-scoped
 * by RLS on the server render) — no new data paths, no secrets. The file is
 * prefixed with a UTF-8 BOM so Excel opens Arabic/Hebrew text correctly.
 */

export type CsvCell = string | number | boolean | null | undefined;

/**
 * RFC-4180 quoting + spreadsheet formula-injection defense.
 *
 * Exported cells can contain ANONYMOUS guest-controlled text (a showcase
 * guest's store name / phone flows into orders). A cell starting with
 * = + - @ (or a control char Excel treats as a formula lead) is neutralized
 * with a leading apostrophe so Excel/Sheets render it as literal text instead
 * of evaluating it (blocks HYPERLINK/DDE payloads; also stops `+9725…` phones
 * being parsed as numbers).
 */
function quote(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  let s = String(cell);
  // Only STRING cells can carry attacker text; numbers/booleans we generate
  // are never injection vectors, so legit negative deltas/totals stay numeric.
  if (typeof cell === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(quote).join(",")];
  for (const row of rows) lines.push(row.map(quote).join(","));
  return lines.join("\r\n");
}

/** Trigger a browser download of the CSV (client components only). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
