"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Locale } from "@/i18n/config";
import { signOutAction } from "@/lib/actions/auth";

/** Sign the supplier out and return to the login screen. */
export function LogoutButton({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      await signOutAction(locale);
      router.replace(`/${locale}/login`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={label}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-field text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
    >
      <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
    </button>
  );
}
