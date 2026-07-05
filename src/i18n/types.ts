/**
 * Dictionary contract — every locale must satisfy this shape, so a missing
 * translation is a TypeScript error, not a runtime surprise.
 *
 * Strings with a `{token}` placeholder are interpolated with
 * `interpolate()` from src/i18n/dictionaries/index.ts.
 */
export interface Dictionary {
  meta: {
    appName: string;
    appNameNative: string;
    tagline: string;
    description: string;
  };
  common: {
    search: string;
    all: string;
    add: string;
    remove: string;
    cancel: string;
    save: string;
    close: string;
    back: string;
    print: string;
    total: string;
    subtotal: string;
    items: string;
    notes: string;
    optional: string;
    actions: string;
    status: string;
    date: string;
    phone: string;
    city: string;
    contact: string;
    viewAll: string;
    language: string;
    demoBadge: string;
    mockNotice: string;
    packages: string;
    clear: string;
    filters: string;
    select: string;
  };
  availability: {
    inStock: string;
    lowStock: string;
    outOfStock: string;
  };
  packaging: {
    carton: string;
    pack: string;
    unit: string;
  };
  units: {
    bottles: string;
    cans: string;
    packs: string;
    units: string;
    bags: string;
    jars: string;
    bars: string;
    rolls: string;
    tubs: string;
  };
  nav: {
    home: string;
    catalog: string;
    cart: string;
    admin: string;
    dashboard: string;
    products: string;
    orders: string;
    inventory: string;
    customers: string;
    documents: string;
    exitAdmin: string;
  };
  landing: {
    heroBadge: string;
    heroTitle: string;
    heroSubtitle: string;
    ctaCatalog: string;
    ctaAdmin: string;
    rolesTitle: string;
    roles: {
      rep: { title: string; desc: string; cta: string };
      owner: { title: string; desc: string; cta: string };
      admin: { title: string; desc: string; cta: string };
    };
    featuresTitle: string;
    features: { title: string; desc: string }[];
    browseByCategory: string;
  };
  catalog: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    categories: string;
    manufacturers: string;
    clearFilters: string;
    /** `{count}` — number of matching products */
    resultsCount: string;
    noResults: string;
    noResultsHint: string;
    orderingFor: string;
    selectShop: string;
    changeShop: string;
    noShop: string;
    addToCart: string;
    inCart: string;
    viewCart: string;
    expiryTracked: string;
  };
  product: {
    packageInfo: string;
    pricePerUnit: string;
    pricePerPackage: string;
    availability: string;
    manufacturer: string;
    category: string;
    sku: string;
    addToCart: string;
    related: string;
    backToCatalog: string;
  };
  cart: {
    title: string;
    empty: string;
    emptyHint: string;
    browseCatalog: string;
    orderNotes: string;
    notesPlaceholder: string;
    shopSection: string;
    shopHint: string;
    orderSummary: string;
    vatNote: string;
    proceedCheckout: string;
    continueShopping: string;
  };
  checkout: {
    title: string;
    summary: string;
    shopDetails: string;
    shopName: string;
    contactName: string;
    delivery: string;
    asap: string;
    scheduled: string;
    sendOrder: string;
    disclaimer: string;
    /** `{count}` — number of lines in the order */
    itemsCount: string;
  };
  orderSuccess: {
    title: string;
    subtitle: string;
    orderNumberLabel: string;
    whatNext: string;
    steps: string[];
    backToCatalog: string;
    adminHint: string;
  };
  status: {
    new: string;
    confirmed: string;
    preparing: string;
    delivered: string;
    cancelled: string;
  };
  admin: {
    title: string;
    overviewTitle: string;
    overviewSubtitle: string;
    metrics: {
      newOrders: string;
      openOrders: string;
      monthRevenue: string;
      activeProducts: string;
      lowStock: string;
      activeShops: string;
    };
    recentOrders: string;
    lowStockTitle: string;
    quickActions: string;
    actionNewProduct: string;
    actionViewOrders: string;
    actionOpenCatalog: string;
    products: {
      title: string;
      subtitle: string;
      addProduct: string;
      searchPlaceholder: string;
      colProduct: string;
      colCategory: string;
      colManufacturer: string;
      colPackage: string;
      colPrice: string;
      colAvailability: string;
      new: {
        title: string;
        subtitle: string;
        sectionBasics: string;
        sectionTranslations: string;
        sectionPackaging: string;
        sectionPricing: string;
        nameHe: string;
        nameAr: string;
        nameEn: string;
        category: string;
        manufacturer: string;
        packageType: string;
        unitsPerPackage: string;
        baseUnit: string;
        wholesalePrice: string;
        trackExpiry: string;
        trackExpiryHint: string;
        availability: string;
        save: string;
        mockNotice: string;
        savedToast: string;
        backToList: string;
      };
    };
    orders: {
      title: string;
      subtitle: string;
      colOrder: string;
      colShop: string;
      colItems: string;
      colTotal: string;
      colStatus: string;
      colDate: string;
      detail: {
        title: string;
        itemsTitle: string;
        shopTitle: string;
        notesTitle: string;
        noNotes: string;
        statusTitle: string;
        statusHint: string;
        previewDoc: string;
        placedOn: string;
        /** `{count}` — number of lines in the order */
        itemsCount: string;
      };
    };
    inventory: {
      title: string;
      subtitle: string;
      colProduct: string;
      colStock: string;
      colLocation: string;
      colExpiry: string;
      noExpiry: string;
      lowOnly: string;
      expiringSoon: string;
    };
    customers: {
      title: string;
      subtitle: string;
      colShop: string;
      colType: string;
      colCity: string;
      colPhone: string;
      colOrders: string;
      colLastOrder: string;
      startOrder: string;
      types: {
        grocery: string;
        kiosk: string;
        supermarket: string;
        minimarket: string;
      };
    };
    documents: {
      title: string;
      subtitle: string;
      colDoc: string;
      colType: string;
      colOrder: string;
      colShop: string;
      colDate: string;
      open: string;
      legalBanner: string;
    };
  };
  docs: {
    types: {
      order: string;
      delivery: string;
      invoiceDraft: string;
    };
    preview: string;
    draftWatermark: string;
    notLegalNotice: string;
    docLanguage: string;
    supplier: string;
    billTo: string;
    docDate: string;
    docNumber: string;
    orderRef: string;
    colItem: string;
    colQty: string;
    colUnit: string;
    colUnitPrice: string;
    colTotal: string;
    subtotal: string;
    vatEstimate: string;
    totalEstimate: string;
    vatDisclaimer: string;
    receivedBy: string;
    signature: string;
    printAction: string;
    backToDocuments: string;
    supplierIdLabel: string;
  };
  notFound: {
    title: string;
    subtitle: string;
    backHome: string;
  };
}
