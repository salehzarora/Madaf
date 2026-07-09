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
    menu: string;
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
    manufacturers: string;
    team: string;
    settings: string;
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
    /** Shown when /catalog is opened without an authenticated tenant/token. */
    privateTitle: string;
    privateBody: string;
    orderingFor: string;
    selectShop: string;
    changeShop: string;
    noShop: string;
    addToCart: string;
    inCart: string;
    viewCart: string;
    expiryTracked: string;
    /** Catalog v2 command-bar sort control. */
    sort: string;
    sortFeatured: string;
    sortPriceAsc: string;
    sortPriceDesc: string;
    sortName: string;
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
    /** Shown when a real (Supabase-mode) order submission fails. */
    sendError: string;
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
      todayOrders: string;
    };
    recentOrders: string;
    lowStockTitle: string;
    quickActions: string;
    actionNewProduct: string;
    actionViewOrders: string;
    actionOpenCatalog: string;
    /** Dashboard v2 (charts + widgets). */
    dashboard: {
      trend: string;
      trendSub: string;
      statusMix: string;
      topProducts: string;
      topCustomers: string;
      byRevenue: string;
      today: string;
      lowSub: string;
      emptyLabel: string;
      /** `{count}` orders. */
      ordersCount: string;
    };
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
      colActions: string;
      edit: string;
      activate: string;
      deactivate: string;
      inactiveBadge: string;
      filterStatus: string;
      statusActive: string;
      new: {
        title: string;
        subtitle: string;
        editTitle: string;
        editSubtitle: string;
        sectionBasics: string;
        sectionTranslations: string;
        sectionPackaging: string;
        sectionPricing: string;
        sectionImage: string;
        sectionInventory: string;
        nameHe: string;
        nameAr: string;
        nameEn: string;
        category: string;
        manufacturer: string;
        manufacturerNone: string;
        sku: string;
        barcode: string;
        packageType: string;
        unitsPerPackage: string;
        baseUnit: string;
        unitSize: string;
        unitSizeHint: string;
        wholesalePrice: string;
        vatRate: string;
        trackExpiry: string;
        trackExpiryHint: string;
        active: string;
        activeHint: string;
        imageUrl: string;
        imageUrlHint: string;
        uploadImage: string;
        uploading: string;
        uploadTypeError: string;
        uploadSizeError: string;
        uploadFailed: string;
        removeImage: string;
        stockQuantity: string;
        lowStockThreshold: string;
        warehouseLocation: string;
        expiryDate: string;
        save: string;
        saving: string;
        /** Shown atop the form in mock mode. */
        mockNotice: string;
        /** Shown atop the form in Supabase mode. */
        liveNotice: string;
        savedToast: string;
        saveError: string;
        backToList: string;
      };
    };
    manufacturers: {
      title: string;
      subtitle: string;
      add: string;
      addTitle: string;
      editTitle: string;
      colName: string;
      colActions: string;
      edit: string;
      nameHe: string;
      nameAr: string;
      nameEn: string;
      logoUrl: string;
      logoUrlHint: string;
      save: string;
      saving: string;
      mockNotice: string;
      savedToast: string;
      saveError: string;
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
      colRef: string;
      searchPlaceholder: string;
      detail: {
        title: string;
        itemsTitle: string;
        shopTitle: string;
        notesTitle: string;
        noNotes: string;
        statusTitle: string;
        statusHint: string;
        /** Hint when status changes really persist (Supabase mode). */
        statusHintLive: string;
        /** Shown when a real (Supabase-mode) status update fails. */
        statusUpdateError: string;
        previewDoc: string;
        placedOn: string;
        /** `{count}` — number of lines in the order */
        itemsCount: string;
        customerRef: string;
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
      /** Clarifies these are the supplier's business customers (stores). */
      addCustomer: string;
      edit: string;
      addressLabel: string;
      recentOrders: string;
      noOrders: string;
      viewAllOrders: string;
      empty: string;
      emptyHint: string;
      types: {
        grocery: string;
        kiosk: string;
        supermarket: string;
        minimarket: string;
      };
      form: {
        newTitle: string;
        newSubtitle: string;
        editTitle: string;
        editSubtitle: string;
        sectionBasics: string;
        sectionContact: string;
        name: string;
        nameHint: string;
        type: string;
        contactName: string;
        phone: string;
        address: string;
        cityHe: string;
        cityAr: string;
        cityEn: string;
        cityHint: string;
        notes: string;
        notesHint: string;
        save: string;
        saving: string;
        savedToast: string;
        saveError: string;
        mockNotice: string;
        liveNotice: string;
        backToList: string;
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
    /** M6B: tenant tax settings (INERT — no legal invoice issuing exists). */
    settings: {
      title: string;
      subtitle: string;
      /** PERMANENT warning — nothing is issued. Never remove. */
      notActiveWarning: string;
      flagsTitle: string;
      flagsSubtitle: string;
      flagInvoicing: string;
      flagProvider: string;
      flagNumbering: string;
      statusOff: string;
      statusDisabled: string;
      sectionIdentity: string;
      sectionAddress: string;
      sectionContact: string;
      sectionReadiness: string;
      legalName: string;
      businessRegistrationNumber: string;
      vatRegistrationNumber: string;
      vatRegistrationType: string;
      countryCode: string;
      defaultVatRate: string;
      invoiceLanguage: string;
      invoiceLanguageAuto: string;
      street: string;
      city: string;
      postalCode: string;
      country: string;
      contactEmail: string;
      contactPhone: string;
      legalInvoicingReady: string;
      legalInvoicingReadyHint: string;
      readinessNotes: string;
      liveNotice: string;
      mockNotice: string;
      save: string;
      saving: string;
      savedToast: string;
      saveError: string;
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
    /** M5A: "Download PDF" action on the order documents card. */
    downloadPdf: string;
    /** M5A: universal PDF footer — generated by Madaf, not a tax invoice. */
    pdfFooter: string;
    /** M5B: document lifecycle status labels. */
    status: {
      draft: string;
      generated: string;
      voided: string;
    };
    /** M5B: regenerate a stored PDF. */
    regenerate: string;
    /** M5B: no PDF stored/generated for this type yet. */
    notGenerated: string;
  };
  notFound: {
    title: string;
    subtitle: string;
    backHome: string;
  };
  /** Auth, onboarding, private shop links, and the tokenized shop (M4A). */
  access: {
    login: {
      title: string;
      subtitle: string;
      email: string;
      password: string;
      signIn: string;
      signingIn: string;
      error: string;
      signUp: string;
      signingUp: string;
      signUpError: string;
      forgotPassword: string;
      noAccount: string;
      haveAccount: string;
      /** Toggle between phone OTP and email/password (M7B). */
      useEmail: string;
      usePhone: string;
      /** Phone-number OTP sign-in (M7B, primary method). */
      phone: {
        step1Subtitle: string;
        label: string;
        placeholder: string;
        hint: string;
        sendCode: string;
        sendingCode: string;
        step2Subtitle: string;
        codeLabel: string;
        codePlaceholder: string;
        verify: string;
        verifying: string;
        resend: string;
        /** Resend cooldown label; `{seconds}` is replaced with the count. */
        resendCountdown: string;
        changeNumber: string;
        invalidPhone: string;
        sendError: string;
        verifyError: string;
        /** DEV-only banner shown when the fake-OTP test path is enabled. */
        devNotice: string;
      };
    };
    tenant: {
      switch: string;
    };
    reset: {
      requestTitle: string;
      requestSubtitle: string;
      email: string;
      sendLink: string;
      sending: string;
      sentTitle: string;
      sentBody: string;
      newSubtitle: string;
      newPassword: string;
      update: string;
      updating: string;
      updatedTitle: string;
      updatedBody: string;
      backToLogin: string;
      error: string;
    };
    session: {
      signedInAs: string;
      logout: string;
      roles: {
        owner: string;
        admin: string;
        sales_rep: string;
      };
    };
    onboarding: {
      title: string;
      subtitle: string;
      nameHe: string;
      nameAr: string;
      nameEn: string;
      defaultLocale: string;
      create: string;
      creating: string;
      error: string;
    };
    noTenant: {
      title: string;
      body: string;
    };
    links: {
      title: string;
      subtitle: string;
      create: string;
      label: string;
      labelPlaceholder: string;
      expiry: string;
      expiryNever: string;
      expiryDays: string;
      generate: string;
      generating: string;
      createdTitle: string;
      createdHint: string;
      copy: string;
      copied: string;
      revoke: string;
      regenerate: string;
      regenerating: string;
      regenerateHint: string;
      colLabel: string;
      colStatus: string;
      colToken: string;
      colExpires: string;
      colLastUsed: string;
      statusActive: string;
      statusRevoked: string;
      statusExpired: string;
      never: string;
      none: string;
      empty: string;
      error: string;
      revokeError: string;
      manage: string;
      mockNote: string;
      backToCustomers: string;
    };
    shop: {
      welcome: string;
      orderingFor: string;
      from: string;
      empty: string;
      submit: string;
      submitting: string;
      successTitle: string;
      successBody: string;
      orderNumberLabel: string;
      refHint: string;
      error: string;
      invalidTitle: string;
      invalidBody: string;
      vatNote: string;
      disclaimer: string;
    };
    team: {
      title: string;
      subtitle: string;
      membersTitle: string;
      invitesTitle: string;
      colEmail: string;
      colRole: string;
      colJoined: string;
      colStatus: string;
      colExpires: string;
      inviteEmail: string;
      inviteEmailPlaceholder: string;
      inviteRole: string;
      expiry: string;
      expiryNever: string;
      expiryDays: string;
      sendInvite: string;
      sending: string;
      createdTitle: string;
      createdHint: string;
      copy: string;
      copied: string;
      revoke: string;
      remove: string;
      changeRole: string;
      you: string;
      statusPending: string;
      statusAccepted: string;
      statusRevoked: string;
      statusExpired: string;
      noMembers: string;
      noInvites: string;
      never: string;
      none: string;
      lastOwnerNote: string;
      error: string;
      revokeError: string;
      roleError: string;
      removeError: string;
      confirmRemove: string;
      promoteOwner: string;
      demoteOwner: string;
      confirmPromote: string;
      confirmDemote: string;
      ownerError: string;
      assignmentsTitle: string;
      assignmentsSubtitle: string;
      assignError: string;
      noReps: string;
      assignedCount: string;
      noAssignments: string;
      assignCustomer: string;
      assign: string;
      unassign: string;
    };
    invite: {
      title: string;
      body: string;
      signedInAs: string;
      loginRequired: string;
      loginCta: string;
      accept: string;
      accepting: string;
      successTitle: string;
      successBody: string;
      goToAdmin: string;
      errorWrongEmail: string;
      errorAlreadyMember: string;
      errorInvalid: string;
      errorGeneric: string;
    };
  };
}
