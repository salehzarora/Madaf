"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { startNativePushSync, PUSH_RESUME_EVENT } from "@/lib/client/native-push";

export function NativePushRegistration({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  useEffect(() => startNativePushSync(window, locale), [locale]);
  useEffect(() => { window.dispatchEvent(new Event(PUSH_RESUME_EVENT)); }, [pathname]);
  return null;
}
