"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Menu } from "lucide-react";

/** The marketing shell stays on the server; only menu dismissal needs a client. */
export function MarketingMobileMenu({ label, children }: { label: string; children?: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, []);

  return <details ref={ref} className="marketing-mobile-menu" onClick={event => {
    if ((event.target as Element).closest("a") && ref.current) ref.current.open = false;
  }}>
    <summary aria-label={label}><Menu aria-hidden /></summary>
    <nav aria-label={label}>{children}</nav>
  </details>;
}
