import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Box, Boxes, Building2, ChartNoAxesCombined, Check, ClipboardList, Globe2, LayoutDashboard, Mail, MapPin, Package, Phone, Send, ShieldCheck, Sparkles, Store, UserRound, UserRoundPlus, Users, Warehouse } from "lucide-react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { MarketingMobileMenu } from "./mobile-menu";
import { LogoMark } from "@/components/logo";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { MarketingDictionary } from "@/i18n/dictionaries/marketing";

type CopyProps = { copy: MarketingDictionary };
const asset = (name: string) => `/images/marketing/${name}.webp`;
const featureAssets = [null, "goods", "orders", "warehouse", "store", "team", "delivery", null];
const featureIcons = [LayoutDashboard, Package, ClipboardList, Warehouse, Store, ShieldCheck, Users, Globe2];

function Brand({ locale, tagline }: { locale: Locale; tagline: string }) {
  return <Link className="marketing-brand" href={`/${locale}`} aria-label="MADAF">
    <LogoMark /><span><strong dir="ltr">MADAF</strong><small>{tagline}</small></span>
  </Link>;
}

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description: string; id: string }) {
  return <div className="marketing-section-heading"><span className="marketing-eyebrow">{eyebrow}</span><h2 id={id}>{title}</h2><p>{description}</p></div>;
}

/** Abstract native UI graphic; no fake customer metrics or interactive controls. */
function DashboardArt() {
  return <div className="marketing-dashboard-art" aria-hidden="true">
    <div className="marketing-dashboard-top"><i /><i /><i /><span /></div>
    <div className="marketing-dashboard-body"><div className="marketing-dashboard-rail"><Box /><i /><i /><i /></div>
      <div className="marketing-dashboard-content"><div className="marketing-mini-kpis"><i /><i /><i /></div>
        <div className="marketing-bars">{[35, 55, 43, 72, 62, 92].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div>
        <div className="marketing-mini-lines"><i /><i /><i /></div>
      </div>
    </div><span className="marketing-dashboard-seal"><ShieldCheck /></span>
  </div>;
}

function LanguageArt() {
  return <div className="marketing-language-art" aria-hidden="true"><Globe2 /><span lang="ar">ع</span><span lang="he">א</span><span lang="en">A</span></div>;
}

function PlatformOverview({ copy }: CopyProps) {
  const icons = [Package, ClipboardList, Warehouse, Users, LayoutDashboard];
  return <section id="about" className="marketing-overview marketing-container" aria-labelledby="about-title">
    <div className="marketing-overview-copy"><span className="marketing-eyebrow">{copy.overview.eyebrow}</span><h2 id="about-title">{copy.overview.title}</h2><p>{copy.overview.description}</p><a href="#features" className="marketing-button marketing-button-peach">{copy.overview.cta}<ArrowRight aria-hidden className="marketing-arrow" /></a></div>
    <div className="marketing-orbit" aria-label={copy.overview.connected}>
      <div className="marketing-orbit-ring" aria-hidden />
      <div className="marketing-orbit-center"><LogoMark /><strong dir="ltr">MADAF</strong><small>{copy.overview.connected}</small></div>
      {copy.overview.labels.map((label, i) => { const Icon = icons[i]; return <div className={`marketing-orbit-node marketing-node-${i}`} key={label}><Icon aria-hidden /><span>{label}</span></div>; })}
    </div>
    <div className="marketing-overview-goods"><Image src={asset("goods")} alt="" width={600} height={400} sizes="(max-width: 767px) 80vw, 30vw" /><ul>{copy.overview.checklist.map(item => <li key={item}><Check aria-hidden />{item}</li>)}</ul></div>
  </section>;
}

/** Intentionally NOT a form: no action, submit handler, persistence or API calls. */
function SupplierRequestPreview({ copy }: CopyProps) {
  const c = copy.request;
  const fields = [
    { key: "company", label: c.company, type: "text", icon: Building2 },
    { key: "name", label: c.name, type: "text", icon: UserRound },
    { key: "email", label: c.email, type: "email", icon: Mail },
    { key: "phone", label: c.phone, type: "tel", icon: Phone },
    { key: "city", label: c.city, type: "text", icon: MapPin },
  ];
  return <section id="request" className="marketing-request marketing-container" aria-labelledby="request-title">
    <div className="marketing-request-copy"><span className="marketing-eyebrow">{c.eyebrow}</span><h2 id="request-title">{c.title}</h2><p>{c.description}</p>
      <ul>{c.benefits.map((benefit, i) => { const Icon = [Store, ShieldCheck, Globe2][i]; return <li key={benefit}><Icon aria-hidden /><span>{benefit}</span></li>; })}</ul>
      <Image src={asset("warehouse")} alt="" width={600} height={400} sizes="(max-width: 767px) 90vw, 40vw" />
    </div>
    <fieldset className="marketing-request-form" aria-describedby="request-preview-note">
      <legend className="sr-only">{c.formTitle}</legend><h3>{c.formTitle}</h3><p>{c.formDescription}</p>
      <div className="marketing-field-grid">{fields.map(({ key, label, type, icon: Icon }) => <label className="marketing-field" key={key} htmlFor={`supplier-${key}`}><span>{label}</span><span className="marketing-field-control"><Icon aria-hidden /><input id={`supplier-${key}`} type={type} autoComplete="off" dir={type === "email" || type === "tel" ? "ltr" : undefined} placeholder={label} /></span></label>)}
        <label className="marketing-field" htmlFor="supplier-business"><span>{c.business}</span><span className="marketing-field-control"><Store aria-hidden /><select id="supplier-business" defaultValue=""><option value="" disabled>{c.choose}</option>{c.businessOptions.map(option => <option key={option}>{option}</option>)}</select></span></label>
        <label className="marketing-field marketing-field-wide" htmlFor="supplier-notes"><span>{c.notes}</span><textarea id="supplier-notes" rows={3} placeholder={c.notes} /></label>
      </div>
      <button className="marketing-button marketing-button-peach" type="button" disabled aria-describedby="request-preview-note"><Send aria-hidden />{c.send}</button>
      <p className="marketing-preview-note" id="request-preview-note">{c.preview}</p>
    </fieldset>
  </section>;
}

export function MarketingHome({ locale, common, copy }: { locale: Locale; common: Dictionary["common"]; copy: MarketingDictionary }) {
  const links = [{ id: "home", label: copy.nav.home }, { id: "features", label: copy.nav.features }, { id: "audiences", label: copy.nav.audiences }, { id: "how-it-works", label: copy.nav.how }, { id: "about", label: copy.nav.about }];
  return <div className="storefront-theme marketing-home" id="home">
    <a href="#marketing-main" className="marketing-skip">{copy.nav.skip}</a>
    <header className="marketing-header"><div className="marketing-container marketing-header-inner">
      <Brand locale={locale} tagline={copy.tagline} />
      <nav className="marketing-desktop-nav" aria-label={common.menu}>{links.map(({ id, label }) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <div className="marketing-header-actions"><LocaleSwitcher current={locale} label={common.language} variant="compact" /><Link href={`/${locale}/admin`} className="marketing-login">{copy.nav.login}</Link><a href="#request" className="marketing-button marketing-button-peach marketing-header-cta"><UserRoundPlus aria-hidden />{copy.nav.request}</a>
        <MarketingMobileMenu label={common.menu}>{links.map(({ id, label }) => <a key={id} href={`#${id}`}>{label}</a>)}<Link href={`/${locale}/admin`}>{copy.nav.login}</Link><a href="#request">{copy.nav.request}</a></MarketingMobileMenu>
      </div>
    </div></header>
    <main id="marketing-main">
      <section className="marketing-hero" aria-labelledby="hero-title"><div className="marketing-hero-glow" aria-hidden /><div className="marketing-container marketing-hero-inner">
        <div className="marketing-hero-copy"><span className="marketing-hero-eyebrow"><span />{copy.hero.eyebrow}</span><h1 id="hero-title">{copy.hero.title}<em>{copy.hero.accent}</em></h1><p>{copy.hero.description}</p><div className="marketing-hero-actions"><a href="#request" className="marketing-button marketing-button-peach"><UserRoundPlus aria-hidden />{copy.nav.request}</a><Link href={`/${locale}/catalog`} className="marketing-button marketing-button-outline">{copy.hero.catalog}<ArrowRight className="marketing-arrow" aria-hidden /></Link></div><ul className="marketing-hero-benefits">{copy.hero.benefits.map((text, i) => { const Icon = [ClipboardList, Boxes, Globe2][i]; return <li key={text}><Icon aria-hidden />{text}</li>; })}</ul></div>
        <figure className="marketing-hero-art"><Image src={asset("hero")} alt="" width={1536} height={1024} sizes="(max-width: 767px) 100vw, (max-width: 1100px) 60vw, 800px" preload /><figcaption><Sparkles aria-hidden />{copy.hero.illustration}</figcaption><div className="marketing-art-wordmark" aria-hidden><LogoMark /><span>MADAF</span></div></figure>
      </div></section>
      <PlatformOverview copy={copy} />
      <section id="features" className="marketing-features marketing-container" aria-labelledby="features-title"><SectionHeading id="features-title" {...copy.features} /><div className="marketing-feature-grid">{copy.features.cards.map((card, i) => { const Icon = featureIcons[i]; return <article key={card.title} className="marketing-feature"><div className="marketing-feature-art">{featureAssets[i] ? <Image src={asset(featureAssets[i])} alt="" width={600} height={400} sizes="(max-width: 600px) 90vw, (max-width: 1000px) 45vw, 23vw" /> : i === 0 ? <DashboardArt /> : <LanguageArt />}</div><div className="marketing-feature-copy"><h3><Icon aria-hidden />{card.title}</h3><p>{card.description}</p></div></article>; })}</div></section>
      <section id="how-it-works" className="marketing-how marketing-container" aria-labelledby="how-title"><SectionHeading id="how-title" {...copy.how} /><ol className="marketing-steps">{copy.how.steps.map((step, i) => { const Icon = [UserRoundPlus, Package, ClipboardList, ChartNoAxesCombined][i]; return <li key={step.title}><span className="marketing-step-number">{i + 1}</span><Icon aria-hidden /><h3>{step.title}</h3><p>{step.description}</p>{i < 3 && <span className="marketing-step-arrow" aria-hidden><ArrowRight className="marketing-arrow" /></span>}</li>; })}</ol></section>
      <section id="audiences" className="marketing-audiences marketing-container" aria-labelledby="audiences-title"><SectionHeading id="audiences-title" {...copy.audiences} /><div className="marketing-audience-grid">{copy.audiences.cards.map((card, i) => <article key={card.title}><Image src={asset(["goods", "orders", "warehouse", "store", "delivery"][i])} alt="" width={600} height={400} sizes="(max-width: 600px) 44vw, (max-width: 1000px) 30vw, 18vw" /><h3>{card.title}</h3><p>{card.description}</p></article>)}</div></section>
      <SupplierRequestPreview copy={copy} />
    </main>
    <footer className="marketing-footer"><div className="marketing-container marketing-footer-grid"><div><Brand locale={locale} tagline={copy.tagline} /><p>{copy.footer.description}</p><div className="marketing-footer-languages" aria-hidden><Globe2 /><span>العربية · עברית · English</span></div></div><nav aria-label={copy.footer.quickLinks}><h3>{copy.footer.quickLinks}</h3>{links.slice(1).map(({ id, label }) => <a key={id} href={`#${id}`}>{label}</a>)}</nav><nav aria-label={copy.footer.platform}><h3>{copy.footer.platform}</h3><Link href={`/${locale}/catalog`}>{copy.hero.catalog}</Link><Link href={`/${locale}/admin`}>{copy.nav.login}</Link><a href="#request">{copy.nav.request}</a></nav><div><h3>{copy.footer.contact}</h3><p>{copy.footer.contactNote}</p><a href="#request" className="marketing-footer-contact">{copy.nav.contact}<ArrowRight className="marketing-arrow" aria-hidden /></a></div></div><div className="marketing-container marketing-footer-bottom"><span>{copy.footer.copyright}</span><span>{copy.footer.signature}</span></div></footer>
  </div>;
}
