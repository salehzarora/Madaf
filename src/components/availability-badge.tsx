import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/i18n/types";
import type { Availability } from "@/lib/types";

const toneFor: Record<Availability, "success" | "warning" | "danger"> = {
  inStock: "success",
  lowStock: "warning",
  outOfStock: "danger",
};

export function AvailabilityBadge({
  availability,
  dict,
}: {
  availability: Availability;
  dict: Dictionary["availability"];
}) {
  return (
    <Badge tone={toneFor[availability]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {dict[availability]}
    </Badge>
  );
}
