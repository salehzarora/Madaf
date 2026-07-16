import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/components/admin/product-form";
import { ProductTimeline } from "@/components/admin/product-timeline";
import { InventoryTimeline } from "@/components/admin/inventory-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShelfRule } from "@/components/ui/shelf-rule";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { loadProductTimelineAction } from "@/lib/actions/product-timeline";
import { loadInventoryTimelineAction } from "@/lib/actions/inventory-timeline";
import { getSessionContext } from "@/lib/auth/session";
import {
  getDataMode,
  getInventoryForProduct,
  getInventoryTimelinePage,
  getProduct,
  getProductTimelinePage,
  getTenantTimeZone,
  safeInitialInventoryTimeline,
  safeInitialProductTimeline,
} from "@/lib/data";

/**
 * Edit an existing product. Supabase mode only — in mock mode there is
 * nothing to persist, so the route is not exposed (products table hides
 * the edit link). Rendered as a server component; the form is a client
 * component that submits through the product Server Actions.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  // Editing only makes sense against a real backend.
  if (getDataMode() !== "supabase") notFound();

  // Editing a product is owner/admin only (enforced server-side by
  // update_product). Gate the ROUTE too — deny a sales_rep BEFORE fetching any
  // edit-form data, so navigating straight here yields a 404, not a form (B1).
  const { userId, membership } = await getSessionContext();
  if (!userId) redirect(`/${locale}/login`);
  if (!membership) redirect(`/${locale}/onboarding`);
  // Explicit owner/admin allowlist (never default-allow on any other role).
  if (membership.role !== "owner" && membership.role !== "admin") notFound();

  const product = await getProduct(id);
  if (!product) notFound();

  // Activity timeline (M8I.1) — the FIRST bounded page of this product's real
  // audit_events. RLS scopes it (owner/admin only); the route above already
  // gated a sales_rep out. Read-only: viewing records NO audit event. It is an
  // OPTIONAL section, so its initial read is ISOLATED (safeInitialProductTimeline
  // never throws): a Timeline failure renders a localized, retryable error INSIDE
  // its card and never rejects the required Product edit render. Kicked off
  // before the remaining reads so it still loads concurrently.
  const timelinePromise = safeInitialProductTimeline(() =>
    getProductTimelinePage({ productId: product.id }),
  );
  // M8I.2 — a SEPARATE, isolated Inventory Timeline read (entity_type=inventory).
  // Same owner/admin RLS + isolation contract as the Product Timeline; loaded
  // concurrently and never blocks the Product edit render.
  const inventoryTimelinePromise = safeInitialInventoryTimeline(() =>
    getInventoryTimelinePage({ productId: product.id }),
  );
  const [inventory, timeZone] = await Promise.all([
    getInventoryForProduct(id),
    getTenantTimeZone(),
  ]);
  const [timeline, inventoryTimeline] = await Promise.all([
    timelinePromise,
    inventoryTimelinePromise,
  ]);
  const dict = getDictionary(locale);
  const t = dict.admin.products.new;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {dict.nav.admin}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ink">
          {t.editTitle}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{t.editSubtitle}</p>
        <ShelfRule className="mt-4" />
      </div>
      <ProductForm
        locale={locale}
        dict={dict}
        product={product}
        inventory={inventory}
      />

      {/* Activity timeline (M8I.1) — read-only Product audit events for THIS
          product. Owner/admin only (route-gated + RLS); no controls, no
          mutations, and opening it records nothing. */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{dict.audit.timeline.heading}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductTimeline
            productId={product.id}
            locale={locale}
            dict={dict}
            initial={timeline}
            timeZone={timeZone}
            loadMore={loadProductTimelineAction}
          />
        </CardContent>
      </Card>

      {/* Inventory activity (M8I.2) — read-only inventory SETUP/CONFIG audit
          events (tracking started, threshold/location/expiry changes) for THIS
          product. Owner/admin only (route-gated + RLS); separate from the Product
          Timeline; post-creation quantity changes live in the Inventory Movements
          ledger, not here. */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{dict.audit.inventory.timelineHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          <InventoryTimeline
            productId={product.id}
            locale={locale}
            dict={dict}
            initial={inventoryTimeline}
            timeZone={timeZone}
            loadMore={loadInventoryTimelineAction}
          />
        </CardContent>
      </Card>
    </div>
  );
}
