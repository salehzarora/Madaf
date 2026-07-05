import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, locales } from "@/i18n/config";

/**
 * Locale routing proxy (Next.js 16 — formerly "middleware").
 * Any path without a supported locale prefix is redirected to the
 * default locale, so `/catalog` → `/he/catalog` and `/` → `/he`.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );
  if (pathnameHasLocale) return;

  request.nextUrl.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Skip Next internals and static assets (any path with a file extension).
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
