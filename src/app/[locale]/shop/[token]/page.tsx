import { Link2Off, Store } from "lucide-react";
import { notFound } from "next/navigation";
import { ShopView } from "@/components/shop/shop-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDataMode } from "@/lib/data";
import { getTokenCatalog, isShopLinkInactive } from "@/lib/data/token";

import type { Metadata } from "next";

// The raw token in the URL IS the credential — a leaked link must not
// become search-indexable (M8A).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Tokenized shop — a customer opens their private link with NO login. The
 * token is the credential; the server resolves it to a tenant-scoped
 * catalog (SECURITY DEFINER RPC). Supabase mode only — there are no tokens
 * in mock mode, so the route 404s there.
 */
export default async function ShopTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  if (getDataMode() !== "supabase") notFound();

  const dict = getDictionary(locale);
  const t = dict.access.shop;

  const catalog = await getTokenCatalog(token);

  // Invalid / revoked / expired token — clean dead-end, no detail leaked.
  // M8C: a link that is dead ONLY because the store was deactivated gets its
  // own message so the buyer contacts the supplier instead of assuming a
  // broken link. The RPC boundary blocks both cases regardless.
  if (!catalog) {
    const inactive = await isShopLinkInactive(token);
    return (
      <main className="storefront-theme private-shop private-shop-terminal">
        <div className="private-shop-terminal-panel">
          {inactive ? (
            <>
              <Store className="private-shop-terminal-icon" aria-hidden />
              <h1>{t.inactiveTitle}</h1>
              <p className="private-shop-terminal-body">{t.inactiveBody}</p>
            </>
          ) : (
            <>
              <Link2Off className="private-shop-terminal-icon" aria-hidden />
              <h1>{t.invalidTitle}</h1>
              <p className="private-shop-terminal-body">{t.invalidBody}</p>
            </>
          )}
        </div>
      </main>
    );
  }

  return <ShopView key={token} locale={locale} dict={dict} token={token} catalog={catalog} />;
}
