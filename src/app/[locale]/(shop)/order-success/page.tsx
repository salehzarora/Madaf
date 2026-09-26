import { CheckCircle2, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/**
 * Post-checkout confirmation. The CUSTOMER-FACING public ref arrives via ?n=
 * (checkout passes result.publicRef, never the internal sequential number).
 */
export default async function OrderSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { n } = await searchParams;
  const dict = getDictionary(locale);
  const publicRef = n ?? "MDF-DEMO0000";

  return (
    <div className="storefront-order-success">
      <div className="storefront-order-success-panel">
        <span className="storefront-order-success-icon">
          <CheckCircle2 className="size-11 text-success" aria-hidden />
        </span>

        <h1>
          {dict.orderSuccess.title}
        </h1>
        <p className="storefront-order-success-subtitle">
          {dict.orderSuccess.subtitle}
        </p>

        <div className="storefront-order-success-reference">
          <p>
            {dict.orderSuccess.orderNumberLabel}
          </p>
          <p
            className="storefront-order-success-number"
            dir="ltr"
          >
            {publicRef}
          </p>
        </div>

        <div className="storefront-order-success-next">
          <h2>
            {dict.orderSuccess.whatNext}
          </h2>
          <ol>
            {dict.orderSuccess.steps.map((step, index) => (
              <li key={step}>
                <span>
                  {index + 1}
                </span>
                <p>
                  {step}
                </p>
              </li>
            ))}
          </ol>
        </div>

        <div className="storefront-order-success-actions">
          <Link
            href={`/${locale}/catalog`}
            className="storefront-order-success-primary"
          >
            {dict.orderSuccess.backToCatalog}
          </Link>
          <Link
            href={`/${locale}/admin/orders`}
            className="storefront-order-success-secondary"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            {dict.nav.admin}
          </Link>
        </div>

        <p className="storefront-order-success-hint">
          {dict.orderSuccess.adminHint}
        </p>
      </div>
    </div>
  );
}
