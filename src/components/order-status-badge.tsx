import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/i18n/types";
import type { OrderStatus } from "@/lib/types";

const toneFor: Record<
  OrderStatus,
  "info" | "brand" | "warning" | "success" | "danger"
> = {
  new: "info",
  confirmed: "brand",
  preparing: "warning",
  delivered: "success",
  cancelled: "danger",
};

export function OrderStatusBadge({
  status,
  dict,
}: {
  status: OrderStatus;
  dict: Dictionary["status"];
}) {
  return (
    <Badge tone={toneFor[status]} dot>
      {dict[status]}
    </Badge>
  );
}
