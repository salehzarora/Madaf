"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAgreementsAction, manageAgreementAction } from "@/lib/actions/pricing";
import { validAgreementPrice, type AgreementList, type AgreementProduct } from "@/lib/pricing";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { PackageType, BaseUnit } from "@/lib/types";

export function CustomerSpecialPrices({ customerId, locale, dict }: { customerId: string; locale: Locale; dict: Dictionary }) {
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AgreementList | null } | null>(null);
  const key = `${customerId}:${search}:${revision}`;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { void listAgreementsAction(customerId, search).then(data => {
      if (!cancelled) setResult({ key, data });
    }); }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [customerId, search, key]);
  const data = result?.key === key ? result.data : null;
  return <Card><CardHeader><CardTitle>{dict.pricing.title}</CardTitle></CardHeader><CardContent>
    <Input value={search} maxLength={100} aria-label={dict.pricing.search} placeholder={dict.pricing.search} onChange={e => setSearch(e.target.value)} />
    {data?.mode === "disabled" ? <p className="my-3 text-sm text-ink-soft">{dict.pricing.disabled}</p> : null}
    {!data ? <p role="status" className="my-3">{dict.pricing.unavailable} <button type="button" onClick={() => setRevision(v => v + 1)} className="underline">{dict.pricing.retry}</button></p> : null}
    <div className="divide-y divide-line">
      {data?.products.map(product => <AgreementRow key={`${product.id}:${product.revision}:${product.packageRevision}`} product={product} customerId={customerId} locale={locale} dict={dict} reload={() => setRevision(v => v + 1)} />)}
    </div>
  </CardContent></Card>;
}
function AgreementRow({ product, customerId, locale, dict, reload }: { product: AgreementProduct; customerId: string; locale: Locale; dict: Dictionary; reload: () => void }) {
  const t = dict.pricing;
  const [price, setPrice] = useState(product.price ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function save(action: "set" | "reconfirm" | "remove") {
    if (pending) return;
    if (action !== "remove" && !validAgreementPrice(price)) { setMessage(t.positive); return; }
    setPending(true); setMessage("");
    const ok = await manageAgreementAction({ customerId, productId: product.id, action, revision: product.revision, packageRevision: product.packageRevision, ...(action === "remove" ? {} : { price }) });
    setPending(false); setMessage(ok ? action === "remove" ? t.removed : t.saved : t.changed);
    if (ok) reload();
  }
  return <section className="py-4 min-w-0">
    <h3 className="font-semibold break-words">{product.name[locale]}</h3>
    <p className="text-sm text-ink-soft">{dict.packaging[product.packageUnit as PackageType]}{" · "}<bdi>{product.packageQuantity}</bdi>{" "}{dict.units[product.baseUnit as BaseUnit]}{" · "}<bdi>{product.unitSize}</bdi>{" · "}{t.base}: <bdi dir="ltr">{formatCurrency(Number(product.basePrice), locale)}</bdi></p>
    <p className="my-1 text-sm">{product.status === "stale_package" ? t.stale : product.status === "removed" ? t.removed : product.status === "customer_agreement" ? t.special : t.base}</p>
    <div className="flex flex-wrap gap-2 items-center">
      <Input className="w-40 max-w-full" inputMode="decimal" dir="ltr" value={price} disabled={pending} aria-label={`${t.special}: ${product.name[locale]}`} onChange={e => setPrice(e.target.value)} />
      <Button size="sm" type="button" disabled={pending} onClick={() => void save(product.status === "stale_package" ? "reconfirm" : "set")}>{product.status === "stale_package" ? t.reconfirm : t.save}</Button>
      {product.status === "customer_agreement" || product.status === "stale_package" ? <Button size="sm" variant="outline" type="button" disabled={pending} onClick={() => void save("remove")}>{t.remove}</Button> : null}
    </div>
    {message ? <p role="status" className="mt-2 text-sm">{message}{" "}
      {message === t.changed ? <button type="button" onClick={reload} className="underline">{t.retry}</button> : null}
    </p> : null}
  </section>;
}
