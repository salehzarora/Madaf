import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/i18n/types";
import { type CustomerOrigin, isCustomerOrigin } from "@/lib/types";

/** Origin dictionary subtree (labels + descriptions), localized upstream. */
type OriginDict = Dictionary["admin"]["customers"]["origin"];

/**
 * Tone per acquisition origin. The three KNOWN origins get a coloured dot; the
 * legacy/unknown value is deliberately set apart — a muted, DASHED, dot-less
 * badge — so "we don't reliably know" reads differently from a real origin
 * (never a fake-precise label). Purely presentational: no client hooks, so it
 * renders in both the server detail page and the client table.
 */
const TONE: Record<
  CustomerOrigin,
  { tone: "brand" | "info" | "warning" | "neutral"; dot: boolean; dashed: boolean }
> = {
  manual: { tone: "brand", dot: true, dashed: false },
  signup: { tone: "info", dot: true, dashed: false },
  guest_conversion: { tone: "warning", dot: true, dashed: false },
  legacy_unknown: { tone: "neutral", dot: false, dashed: true },
};

/**
 * Read-only acquisition-origin badge (M8G.1). A row without an explicit origin
 * (legacy in-memory shapes) is treated as legacy_unknown — mirrors the DB
 * NOT NULL default and the filter semantics. Never an editable control.
 */
export function CustomerOriginBadge({
  origin,
  originDict,
  className,
}: {
  origin: CustomerOrigin | undefined;
  originDict: OriginDict;
  className?: string;
}) {
  const value: CustomerOrigin = isCustomerOrigin(origin)
    ? origin
    : "legacy_unknown";
  const style = TONE[value];
  return (
    <Badge
      tone={style.tone}
      dot={style.dot}
      dashed={style.dashed}
      className={className}
      title={originDict.descriptions[value]}
    >
      {originDict.values[value]}
    </Badge>
  );
}
