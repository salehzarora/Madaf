import { cn } from "@/lib/utils";

/**
 * Madaf brand mark — a stylized shelf (three levels, stocked).
 * Pure SVG so it inherits currentColor and scales anywhere.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-8", className)}
    >
      <rect width="32" height="32" rx="8" className="fill-brand-600" />
      {/* shelves */}
      <rect x="7" y="11.5" width="18" height="1.8" rx="0.9" fill="white" />
      <rect x="7" y="18.5" width="18" height="1.8" rx="0.9" fill="white" />
      <rect x="7" y="25" width="18" height="1.8" rx="0.9" fill="white" />
      {/* goods on shelves */}
      <rect x="9" y="6.5" width="4" height="5" rx="1" fill="white" opacity="0.9" />
      <rect x="15" y="8" width="3.2" height="3.5" rx="1" fill="white" opacity="0.65" />
      <rect x="20" y="7" width="4" height="4.5" rx="1" fill="white" opacity="0.8" />
      <rect x="10" y="14.5" width="3.2" height="4" rx="1" fill="white" opacity="0.7" />
      <rect x="16" y="13.8" width="4" height="4.7" rx="1" fill="white" opacity="0.9" />
      <rect x="9" y="21.2" width="4" height="3.8" rx="1" fill="white" opacity="0.85" />
      <rect x="18" y="21.8" width="3.2" height="3.2" rx="1" fill="white" opacity="0.6" />
    </svg>
  );
}

export function LogoWordmark({
  appName,
  appNameNative,
  className,
}: {
  appName: string;
  appNameNative: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-baseline gap-1.5", className)}>
      <span className="text-lg font-bold tracking-tight text-ink">
        {appNameNative}
      </span>
      {appNameNative !== appName ? (
        <span className="text-sm font-medium text-ink-muted">{appName}</span>
      ) : null}
    </span>
  );
}
