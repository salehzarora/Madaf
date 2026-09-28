import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale, locales } from "@/i18n/config";
import { LOCALE_COOKIE } from "@/i18n/locale-preference";

/**
 * Request proxy (Next.js 16 — formerly "middleware"):
 *  1. Locale routing — any path without a supported locale prefix is
 *     redirected to the saved UI locale, or Hebrew on first use.
 *  2. Supabase session refresh — only when the public Supabase env vars
 *     are configured (authenticated/supabase mode). In mock mode there is
 *     no env, so this is skipped and the app stays zero-config.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );
  if (!pathnameHasLocale) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = saved && isLocale(saved) ? saved : defaultLocale;
    request.nextUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    const response = NextResponse.redirect(request.nextUrl);
    // The location is user-specific. Neither a browser nor shared CDN may reuse it.
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  }

  return updateSession(request);
}

/**
 * Refreshes the Supabase auth session cookies on every request (the
 * @supabase/ssr middleware pattern). No-op when Supabase isn't configured.
 */
async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response; // mock mode / not configured

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the session so expiring access tokens are refreshed into cookies.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip Next internals and static assets (any path with a file extension).
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
