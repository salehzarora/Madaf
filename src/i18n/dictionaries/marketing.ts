import type { Locale } from "../config";

type CardCopy = { title: string; description: string };
export interface MarketingDictionary {
  tagline: string;
  nav: { home: string; features: string; audiences: string; how: string; about: string; contact: string; login: string; request: string; skip: string };
  hero: { eyebrow: string; title: string; accent: string; description: string; catalog: string; illustration: string; benefits: string[] };
  overview: { eyebrow: string; title: string; description: string; cta: string; connected: string; labels: string[]; checklist: string[] };
  features: { eyebrow: string; title: string; description: string; cards: CardCopy[] };
  how: { eyebrow: string; title: string; description: string; steps: CardCopy[] };
  audiences: { eyebrow: string; title: string; description: string; cards: CardCopy[] };
  request: { eyebrow: string; title: string; description: string; benefits: string[]; formTitle: string; formDescription: string; company: string; name: string; email: string; phone: string; city: string; business: string; businessOptions: string[]; choose: string; notes: string; send: string; preview: string };
  footer: { description: string; quickLinks: string; platform: string; contact: string; contactNote: string; signature: string; copyright: string };
}

/** Homepage-only copy: kept out of the shared application dictionary/client payload. */
export const marketingDictionaries: Record<Locale, MarketingDictionary> = {
  ar: {
    tagline: "منصة الجملة للمورّدين والمتاجر",
    nav: { home: "الرئيسية", features: "المميزات", audiences: "القطاعات", how: "كيف تعمل", about: "عن مدف", contact: "تواصل معنا", login: "تسجيل الدخول", request: "طلب حساب مورّد", skip: "انتقل إلى المحتوى" },
    hero: { eyebrow: "منصة MADAF للمورّدين", title: "كل مستودع", accent: "أقرب إلى عملائه.", description: "من منتجاتك إلى طلبات عملائك. اجمع الكتالوج والمخزون والمتاجر وفريقك في مساحة واحدة، وامنح أعمالك وضوحًا أكبر كل يوم.", catalog: "استعرض الكتالوج", illustration: "تصوّر توضيحي للمنصة", benefits: ["طلبات أكثر تنظيمًا", "رؤية أوضح للمخزون", "تجربة بثلاث لغات"] },
    overview: { eyebrow: "أعمال مترابطة. إدارة أبسط.", title: "منصة واحدة\nلكل تفاصيل تجارتك", description: "منتجاتك وطلباتك وعملاؤك لا تعمل بمعزل عن بعضها. مدف يجمعها في تجربة مرتّبة، من عرض المنتج حتى متابعة الطلب والمخزون.", cta: "تعرّف على المميزات", connected: "كل شيء مترابط", labels: ["المنتجات", "الطلبات", "المخزون", "العملاء", "لوحة التحكم"], checklist: ["كتالوج واضح", "طلبات منظّمة", "مخزون تحت النظر", "فريق بصلاحيات محددة"] },
    features: { eyebrow: "أدوات تخدم يومك", title: "ماذا يوفّر لك MADAF؟", description: "مساحة عمل مصمّمة لطريقة عمل المورّدين وتجارة الجملة.", cards: [
      { title: "لوحة التحكم", description: "نظرة واضحة على الطلبات والمنتجات وحركة أعمالك." },
      { title: "الكتالوج والمنتجات", description: "اعرض الصور والأسعار وأحجام العبوات في كتالوج مرتب." },
      { title: "إدارة الطلبات", description: "استقبل طلبات المتاجر وتابع حالتها من مكان واحد." },
      { title: "إدارة المخزون", description: "تابع الكميات والحركة وتنبيهات المخزون المنخفض." },
      { title: "العملاء والمتاجر", description: "نظّم بيانات متاجرك وتابع طلبات كل عميل بسهولة." },
      { title: "فريق العمل والصلاحيات", description: "أدوار واضحة للمالك والمدير ومندوب المبيعات." },
      { title: "المبيعات الميدانية", description: "ساعد المندوب على بناء طلبات المتاجر المعيّنة له." },
      { title: "كتالوج بلغات عملائك", description: "العربية والعبرية والإنجليزية، على الهاتف واللوحي والكمبيوتر." },
    ] },
    how: { eyebrow: "خطوات واضحة من البداية", title: "كيف تبدأ مع MADAF؟", description: "من إعداد كتالوجك إلى استقبال طلبات متاجرك.", steps: [
      { title: "طلب حساب مورّد", description: "عرّف بنشاطك. نموذج طلب الحساب قيد التجهيز." },
      { title: "إضافة المنتجات والأسعار", description: "نظّم منتجاتك بالصور وأحجام العبوات والأسعار." },
      { title: "استقبال الطلبات", description: "شارك الكتالوج واستقبل طلبات متاجرك بشكل مرتب." },
      { title: "متابعة أعمالك", description: "تابع المخزون والطلبات وامنح فريقك رؤية أوضح." },
    ] },
    audiences: { eyebrow: "لكل حلقة في تجارة الجملة", title: "صُمّم لطريقة عملك", description: "من المستودع إلى المتجر، تجربة تجمع الأشخاص حول الطلب.", cards: [
      { title: "المورّدون", description: "عرض المنتجات والتواصل مع المتاجر." },
      { title: "موزّعو الجملة", description: "كتالوج منظم لتشكيلة متنوعة من البضائع." },
      { title: "فرق المستودعات", description: "وضوح أكبر في الكميات وحركة المخزون." },
      { title: "أصحاب المتاجر", description: "تصفّح المنتجات وإرسال طلبات مرتبة." },
      { title: "فرق المبيعات والتوزيع", description: "متابعة طلبات العملاء وحالتها مع الفريق." },
    ] },
    request: { eyebrow: "الخطوة التالية لأعمالك", title: "تجارتك تتحرّك.\nإدارتك تواكبها.", description: "امنح منتجاتك مساحة أوضح، وطلباتك تنظيمًا أفضل، وفريقك نقطة التقاء واحدة.", benefits: ["كتالوج يعكس نشاطك", "طلبات واضحة للفريق", "تجربة مناسبة لكل جهاز"], formTitle: "طلب حساب مورّد", formDescription: "تعرّف على بيانات طلب الانضمام إلى MADAF.", company: "اسم الشركة", name: "اسم المسؤول", email: "البريد الإلكتروني", phone: "رقم الجوال", city: "المدينة", business: "نوع النشاط", businessOptions: ["مورّد", "موزّع جملة", "متجر", "نشاط آخر"], choose: "اختر نوع النشاط", notes: "نبذة عن النشاط", send: "إرسال الطلب", preview: "معاينة فقط — إرسال الطلبات غير متاح حاليًا. لا تُحفظ البيانات أو تُرسل." },
    footer: { description: "منصة تجمع كتالوجك وطلباتك ومخزونك، وتقربك من متاجرك كل يوم.", quickLinks: "روابط سريعة", platform: "استكشف المنصة", contact: "لنبقَ على تواصل", contactNote: "نعمل على تجهيز طلبات حسابات المورّدين. يمكنك الآن استكشاف المنصة.", signature: "تفاصيل أقل تشتّتًا. تجارة أكثر وضوحًا.", copyright: "MADAF · منصة الجملة للمورّدين والمتاجر" },
  },
  he: {
    tagline: "פלטפורמת סיטונאות לספקים ולחנויות",
    nav: { home: "בית", features: "יכולות", audiences: "למי זה מתאים", how: "איך מתחילים", about: "על מדף", contact: "יצירת קשר", login: "כניסה", request: "בקשת חשבון ספק", skip: "דילוג לתוכן" },
    hero: { eyebrow: "MADAF · פלטפורמה לספקים", title: "כל מחסן", accent: "קרוב יותר ללקוחות.", description: "מהמוצרים שלכם להזמנות הלקוחות. קטלוג, מלאי, חנויות וצוות במקום אחד, עם תמונה ברורה יותר של העסק בכל יום.", catalog: "לצפייה בקטלוג", illustration: "המחשה של הפלטפורמה", benefits: ["הזמנות מסודרות", "תמונת מלאי ברורה", "חוויה בשלוש שפות"] },
    overview: { eyebrow: "הכול מתחבר. הניהול פשוט יותר.", title: "פלטפורמה אחת\nלכל פרטי העסק", description: "המוצרים, ההזמנות והלקוחות שלכם קשורים זה לזה. מדף מחברת אותם בחוויה מסודרת, מהצגת המוצר ועד למעקב אחר ההזמנה והמלאי.", cta: "לגלות את היכולות", connected: "הכול מחובר", labels: ["מוצרים", "הזמנות", "מלאי", "לקוחות", "לוח בקרה"], checklist: ["קטלוג ברור", "הזמנות מסודרות", "תמונת מלאי זמינה", "הרשאות ברורות לצוות"] },
    features: { eyebrow: "כלים לעבודה היומיומית", title: "מה MADAF נותנת לכם?", description: "סביבת עבודה שמותאמת לספקים ולמסחר סיטונאי.", cards: [
      { title: "לוח בקרה", description: "תמונה ברורה של ההזמנות, המוצרים ופעילות העסק." },
      { title: "קטלוג ומוצרים", description: "תמונות, מחירים וגדלי אריזות בקטלוג מסודר." },
      { title: "ניהול הזמנות", description: "קבלת הזמנות מחנויות ומעקב אחר הסטטוס במקום אחד." },
      { title: "ניהול מלאי", description: "מעקב אחר כמויות, תנועות ומלאי נמוך." },
      { title: "לקוחות וחנויות", description: "ארגון פרטי החנויות וההזמנות של כל לקוח." },
      { title: "צוות והרשאות", description: "תפקידים ברורים לבעלים, למנהלים ולסוכני מכירות." },
      { title: "מכירות בשטח", description: "בניית הזמנות לחנויות שמשויכות לסוכן המכירות." },
      { title: "קטלוג בשפת הלקוחות", description: "עברית, ערבית ואנגלית, בנייד, בטאבלט ובמחשב." },
    ] },
    how: { eyebrow: "דרך ברורה מהצעד הראשון", title: "איך מתחילים עם MADAF?", description: "מהכנת הקטלוג ועד לקבלת הזמנות מהחנויות.", steps: [
      { title: "בקשת חשבון ספק", description: "היכרות עם העסק. טופס הבקשה נמצא בהכנה." },
      { title: "הוספת מוצרים ומחירים", description: "ארגון המוצרים עם תמונות, אריזות ומחירים." },
      { title: "קבלת הזמנות", description: "שיתוף הקטלוג וקבלת הזמנות מסודרות מהחנויות." },
      { title: "מעקב אחר העסק", description: "מעקב אחר מלאי והזמנות עם תמונה ברורה לצוות." },
    ] },
    audiences: { eyebrow: "לכל חוליה במסחר הסיטונאי", title: "מותאמת לדרך העבודה שלכם", description: "מהמחסן לחנות, חוויה שמחברת את האנשים סביב ההזמנה.", cards: [
      { title: "ספקים", description: "הצגת מוצרים וקשר עם החנויות." },
      { title: "מפיצים סיטונאיים", description: "קטלוג מסודר למגוון רחב של סחורות." },
      { title: "צוותי מחסן", description: "תמונה ברורה של כמויות ותנועות מלאי." },
      { title: "בעלי חנויות", description: "עיון במוצרים ושליחת הזמנות מסודרות." },
      { title: "צוותי מכירות והפצה", description: "מעקב משותף אחר הזמנות לקוחות והסטטוס שלהן." },
    ] },
    request: { eyebrow: "הצעד הבא לעסק שלכם", title: "העסק מתקדם.\nהניהול מתקדם איתו.", description: "תנו למוצרים במה ברורה, להזמנות סדר, ולצוות מקום אחד לעבוד יחד.", benefits: ["קטלוג שמשקף את העסק", "הזמנות ברורות לצוות", "חוויה בכל מכשיר"], formTitle: "בקשת חשבון ספק", formDescription: "הכירו את פרטי בקשת ההצטרפות ל-MADAF.", company: "שם החברה", name: "שם איש הקשר", email: "דואר אלקטרוני", phone: "טלפון נייד", city: "עיר", business: "סוג העסק", businessOptions: ["ספק", "מפיץ סיטונאי", "חנות", "עסק אחר"], choose: "בחרו סוג עסק", notes: "כמה מילים על העסק", send: "שליחת הבקשה", preview: "תצוגה מקדימה בלבד — השליחה עדיין אינה זמינה. הפרטים אינם נשמרים או נשלחים." },
    footer: { description: "הקטלוג, ההזמנות והמלאי במקום אחד, קרוב יותר לחנויות שלכם בכל יום.", quickLinks: "קישורים מהירים", platform: "לגלות את הפלטפורמה", contact: "נשארים בקשר", contactNote: "אנחנו מכינים את תהליך בקשת חשבון הספק. בינתיים אפשר להכיר את הפלטפורמה.", signature: "פחות פיזור. יותר בהירות בעסק.", copyright: "MADAF · פלטפורמת סיטונאות לספקים ולחנויות" },
  },
  en: {
    tagline: "The wholesale platform for suppliers & stores",
    nav: { home: "Home", features: "Features", audiences: "Who it’s for", how: "How it works", about: "About", contact: "Contact", login: "Sign in", request: "Request a supplier account", skip: "Skip to content" },
    hero: { eyebrow: "MADAF · Built for suppliers", title: "Every warehouse.", accent: "Closer to its customers.", description: "From your products to your customers’ orders. Bring your catalog, inventory, stores and team into one place, with a clearer view of business every day.", catalog: "Explore the catalog", illustration: "Illustrative platform preview", benefits: ["Organized orders", "Clearer stock visibility", "Three languages, one experience"] },
    overview: { eyebrow: "Connected work. Simpler management.", title: "One platform.\nEvery detail connected.", description: "Your products, orders and customers belong together. MADAF connects them in one considered experience, from discovering a product to following an order and its stock.", cta: "Discover the features", connected: "Everything connected", labels: ["Products", "Orders", "Inventory", "Customers", "Dashboard"], checklist: ["A clear catalog", "Organized orders", "Stock in view", "Defined team permissions"] },
    features: { eyebrow: "Built around your working day", title: "What can MADAF do for you?", description: "A workspace shaped around suppliers and wholesale trade.", cards: [
      { title: "Dashboard", description: "A clear view of orders, products and business activity." },
      { title: "Catalog & products", description: "Photos, prices and package sizes in an organized catalog." },
      { title: "Order management", description: "Receive store orders and follow their status in one place." },
      { title: "Inventory management", description: "Track quantities, movements and low-stock visibility." },
      { title: "Customers & stores", description: "Keep store details and each customer’s orders organized." },
      { title: "Team & permissions", description: "Clear roles for owners, administrators and sales reps." },
      { title: "Sales in the field", description: "Help reps build orders for their assigned stores." },
      { title: "Your customers’ languages", description: "Arabic, Hebrew and English on phone, tablet and desktop." },
    ] },
    how: { eyebrow: "A clear path from the start", title: "How to get started with MADAF", description: "From preparing your catalog to receiving store orders.", steps: [
      { title: "Request an account", description: "Introduce your business. The request form is coming soon." },
      { title: "Add products & prices", description: "Organize your range with photos, packages and prices." },
      { title: "Receive orders", description: "Share your catalog and receive clear orders from stores." },
      { title: "Follow your business", description: "Keep stock and orders in view, together with your team." },
    ] },
    audiences: { eyebrow: "For the people behind wholesale", title: "Made for the way you work", description: "From warehouse to storefront, connect your team around every order.", cards: [
      { title: "Suppliers", description: "Present your products and connect with stores." },
      { title: "Wholesalers", description: "An organized catalog for a diverse product range." },
      { title: "Warehouse teams", description: "A clearer view of quantities and stock movements." },
      { title: "Store owners", description: "Browse products and send organized orders." },
      { title: "Sales & distribution teams", description: "Follow customer orders and their status together." },
    ] },
    request: { eyebrow: "The next step for your business", title: "Business moves.\nKeep everything in step.", description: "Give your products a clearer presence, your orders more structure, and your team one place to come together.", benefits: ["A catalog that reflects your business", "Clear orders for your team", "An experience for every device"], formTitle: "Request a supplier account", formDescription: "Preview the details for joining MADAF.", company: "Company name", name: "Contact name", email: "Email address", phone: "Mobile number", city: "City", business: "Business type", businessOptions: ["Supplier", "Wholesaler", "Store", "Other business"], choose: "Choose your business type", notes: "Tell us about your business", send: "Send request", preview: "Preview only — submissions are not available yet. Details are not saved or sent." },
    footer: { description: "Your catalog, orders and inventory together. Closer to your stores, every day.", quickLinks: "Quick links", platform: "Explore MADAF", contact: "Let’s stay connected", contactNote: "Supplier account requests are being prepared. For now, take a look around the platform.", signature: "Less scattered detail. More clarity for your business.", copyright: "MADAF · The wholesale platform for suppliers & stores" },
  },
};
