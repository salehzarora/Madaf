import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-surface shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  variant = "plain",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "plain" | "strip" }) {
  // "strip" = the warm shelf-edge header band on every list/table/widget card.
  return (
    <div
      className={cn(
        variant === "strip"
          ? "flex items-center justify-between border-b border-line bg-surface-warm px-5 py-3.5"
          : "flex flex-col gap-1 p-5 pb-0 sm:p-6 sm:pb-0",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[15px] font-bold text-ink", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 sm:p-6", className)} {...props} />;
}
