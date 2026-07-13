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
    /** M8C — admin CSV export button + empty tooltip (orders/products/movements). */
    exportCsv: string;
    exportEmpty: string;
    /** M8E — CSV export in progress (server round-trip over all filtered rows). */
    exporting: string;
    /** M8E — shown when a filtered export hit the row cap; {count} = rows written. */
    exportCapped: string;
    /** M8E.1 — image upload: bytes are not a real/matching image (corrupt/spoofed). */
    uploadInvalid: string;
    /** M8E.1 — reassurance shown on any upload failure: the current image stayed. */
    uploadKeepCurrent: string;
    /** M8E.2 — a tokenized public link could not be built (app URL unconfigured). */
    linkUrlError: string;
    /** M8E.2 — a link could not be generated due to an internal validation issue. */
    linkGenerationError: string;
    /** M8E.2 — a generic operation/persistence/transport failure (safe, no details). */
    actionError: string;
    /** M8D — shown where a role-gated action is hidden for a sales_rep. */
    noPermission: string;
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
    /** Search box in the shop picker (M7I) — name / contact / phone / city. */
    searchShops: string;
    noShopsFound: string;
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
      /** M8C — today's order value (ex-VAT). */
      todayValue: string;
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
      /** M8B.4 — operational alert cards. */
      alerts: {
        needsConfirmation: string;
        /** `{count}` new orders awaiting confirmation. */
        needsConfirmationCount: string;
        needsConfirmationNone: string;
        preparing: string;
        /** `{count}` orders confirmed/preparing. */
        preparingCount: string;
        preparingNone: string;
        guestOrders: string;
        /** `{count}` pending guest orders. */
        guestOrdersCount: string;
        guestOrdersNone: string;
        signupRequests: string;
        /** `{count}` pending signup requests. */
        signupRequestsCount: string;
        signupRequestsNone: string;
        lowStock: string;
        /** `{count}` products at/below their threshold. */
        lowStockCount: string;
        lowStockNone: string;
      };
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
      /** M8F.2 — server-side pagination: "Page {page} of {pages}". */
      pageLabel: string;
      /** M8F.2 — previous-page control label. */
      prevPage: string;
      /** M8F.2 — next-page control label. */
      nextPage: string;
      /** M8F.2 — clear all active product filters. */
      clearFilters: string;
      /** M8D — localized CSV headers for the products export. */
      csv: {
        name: string;
        sku: string;
        barcode: string;
        category: string;
        manufacturer: string;
        price: string;
        status: string;
        stock: string;
        lowStock: string;
      };
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
      /** M8E.3 — brand logo upload (private bucket, signed on read). */
      logoLabel: string;
      /** M8E.1 — where the manufacturer logo appears (helper text). */
      logoHelp: string;
      uploadLogo: string;
      uploading: string;
      logoOrUrl: string;
      removeLogo: string;
      uploadTypeError: string;
      uploadSizeError: string;
      uploadFailed: string;
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
      /** M8D — clear all active filters. */
      clearFilters: string;
      /** M8F.1 — server-side pagination: "{count} orders" filtered-total label. */
      resultsCount: string;
      /** M8F.1 — "Page {page} of {pages}". */
      pageLabel: string;
      /** M8F.1 — previous-page control label. */
      prevPage: string;
      /** M8F.1 — next-page control label. */
      nextPage: string;
      /** M8F.1 — empty filtered result (no orders match). */
      noResults: string;
      /** M8F.1 — hint under the empty state. */
      noResultsHint: string;
      /** M8D — localized CSV headers for the orders export. */
      csv: {
        orderNumber: string;
        publicRef: string;
        date: string;
        status: string;
        store: string;
        guest: string;
        source: string;
        total: string;
        itemCount: string;
        phone: string;
      };
      /** M8C — order source facets. */
      sourceFilter: {
        sales_visit: string;
        shop_link: string;
        guest: string;
      };
      /** M8C — date-range filter (shared with movements). */
      dateFilter: {
        label: string;
        all: string;
        today: string;
        last7: string;
        month: string;
        custom: string;
        from: string;
        to: string;
      };
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
        internalRef: string;
        /** Fallback line label when an order item's product row is gone (M8A). */
        unavailableProduct: string;
        /** Shown when reserving stock on confirm/preparing is blocked (M7I). */
        statusInsufficientStock: string;
        /** Informational: stock returned after a reserved order is cancelled. */
        stockRestored: string;
        /** M7I — guest (showcase) order store details + promote-to-customer. */
        guest: {
          title: string;
          badge: string;
          hint: string;
          oneTime: string;
          email: string;
          create: string;
          creating: string;
          createError: string;
          created: string;
          /** M8B.3 — order linked to an existing store instead. */
          linked: string;
          duplicateTitle: string;
          duplicatePhoneMatch: string;
          duplicateNameMatch: string;
          linkExisting: string;
          createAnyway: string;
        };
        /** M7I — owner/admin order line editing. */
        edit: {
          button: string;
          title: string;
          addProduct: string;
          searchProduct: string;
          noneToAdd: string;
          remove: string;
          empty: string;
          reservedHint: string;
          lockedHint: string;
          save: string;
          saving: string;
          cancel: string;
          error: string;
          insufficientStock: string;
          success: string;
        };
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
      /** M8D — empty state when the low-stock filter has no matches. */
      lowEmpty: string;
      /** M8B.1 — stock-movement ledger history view. */
      movements: {
        navLabel: string;
        title: string;
        subtitle: string;
        searchPlaceholder: string;
        allReasons: string;
        colDate: string;
        colProduct: string;
        colDelta: string;
        colReason: string;
        colOrder: string;
        colNote: string;
        /** M8D — localized CSV headers for the movements export. */
        csv: {
          date: string;
          product: string;
          sku: string;
          delta: string;
          reason: string;
          note: string;
          order: string;
          publicRef: string;
        };
        /** Order column value for manual (order-less) adjustments. */
        manualBadge: string;
        /** Shown when older rows exist beyond the loaded pages. */
        truncatedNote: string;
        loadMore: string;
        loadingMore: string;
        empty: string;
        emptyHint: string;
        direction: { all: string; in: string; out: string };
        reasons: {
          order_reserved: string;
          order_reservation_released: string;
          order_edit_adjustment: string;
          order_delivered: string;
          manual_stock_count: string;
          manual_damaged_goods: string;
          manual_returned_goods: string;
          manual_supplier_delivery: string;
          manual_correction: string;
          manual_other: string;
        };
      };
      /** M8B.2 — manual stock adjustment. */
      adjust: {
        button: string;
        title: string;
        deltaLabel: string;
        deltaPlaceholder: string;
        reasonLabel: string;
        reasonPlaceholder: string;
        currentLabel: string;
        newLabel: string;
        noteLabel: string;
        save: string;
        saving: string;
        success: string;
        errors: {
          negative: string;
          reasonRequired: string;
          deltaRequired: string;
          failed: string;
        };
      };
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
      /** M8B.5 — stores list search. */
      searchPlaceholder: string;
      noMatches: string;
      /** M8E.2 — server-side pagination + private-link facet. */
      loadMore: string;
      loadingMore: string;
      linkFilter: {
        label: string;
        all: string;
        has: string;
        none: string;
      };
      /** M8G.1 — immutable acquisition origin (how the store first joined). */
      origin: {
        /** Row/column + filter label. */
        label: string;
        /** "all origins" filter option. */
        all: string;
        /** Short badge labels per origin value. */
        values: {
          manual: string;
          signup: string;
          guest_conversion: string;
          legacy_unknown: string;
        };
        /** One-line definitions (badge tooltip + detail metadata). */
        descriptions: {
          manual: string;
          signup: string;
          guest_conversion: string;
          legacy_unknown: string;
        };
        /** Heading on the customer detail card. */
        detailLabel: string;
      };
      /** M8C — store active/inactive lifecycle. */
      lifecycle: {
        activeBadge: string;
        inactiveBadge: string;
        activate: string;
        deactivate: string;
        deactivateConfirm: string;
        error: string;
        filterLabel: string;
      };
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
        /** M8B.3 — duplicate-store warning on manual create. */
        duplicateTitle: string;
        duplicatePhoneMatch: string;
        duplicateNameMatch: string;
        createAnyway: string;
      };
      /** M7G — new-store self-signup management (owner/admin). */
      signup: {
        navLabel: string;
        title: string;
        subtitle: string;
        createLink: string;
        creating: string;
        createdTitle: string;
        createdHint: string;
        copy: string;
        copied: string;
        expiry: string;
        expiryNever: string;
        /** `{count}` days */
        expiryDays: string;
        linksTitle: string;
        colLink: string;
        colStatus: string;
        colToken: string;
        colExpires: string;
        statusActive: string;
        statusRevoked: string;
        statusExpired: string;
        revoke: string;
        noLinks: string;
        requestsTitle: string;
        requestsSubtitle: string;
        colStore: string;
        colContact: string;
        colSubmitted: string;
        approve: string;
        approving: string;
        reject: string;
        rejecting: string;
        statusPending: string;
        statusApproved: string;
        statusRejected: string;
        viewStore: string;
        noRequests: string;
        /** `{count}` pending requests — header badge/CTA */
        pendingBadge: string;
        /** M8B.3 — duplicate-store warning on approval. */
        duplicateTitle: string;
        duplicatePhoneMatch: string;
        duplicateNameMatch: string;
        approveAnyway: string;
        error: string;
        never: string;
        none: string;
        showcaseTitle: string;
        showcaseSubtitle: string;
        showcaseCreate: string;
        showcaseNoLinks: string;
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
      /** M8E.4 — business/profile settings (NON-LEGAL, display only). */
      business: {
        navLabel: string;
        title: string;
        subtitle: string;
        sectionIdentity: string;
        sectionAddress: string;
        sectionContact: string;
        sectionBranding: string;
        /** M8E.1 — where the business logo appears (settings helper text). */
        logoHelp: string;
        nameAr: string;
        nameHe: string;
        nameEn: string;
        phone: string;
        email: string;
        addressAr: string;
        addressHe: string;
        addressEn: string;
        legalName: string;
        companyId: string;
        displayVatRate: string;
        displayVatRateHint: string;
        /** PERMANENT non-legal note — these settings issue no legal invoice. */
        nonLegalNote: string;
        logo: string;
        uploadLogo: string;
        uploading: string;
        logoOrUrl: string;
        removeLogo: string;
        uploadTypeError: string;
        uploadSizeError: string;
        uploadFailed: string;
        mockNotice: string;
        save: string;
        saving: string;
        savedToast: string;
        saveError: string;
      };
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
      /** M8C — no new/regenerated links for a deactivated store. */
      inactiveError: string;
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
      /** M7H — the store is fixed by the link and cannot be changed. */
      storeLocked: string;
      /** M8C — the link's store is deactivated (distinct from invalid). */
      inactiveTitle: string;
      inactiveBody: string;
      error: string;
      invalidTitle: string;
      invalidBody: string;
      vatNote: string;
      disclaimer: string;
    };
    /** M7H → M7I — anonymous product showcase + guest ordering (supplier link). */
    showcase: {
      browseOrder: string;
      intro: string;
      empty: string;
      reviewOrder: string;
      estimatedTotal: string;
      checkoutTitle: string;
      checkoutIntro: string;
      backToProducts: string;
      submit: string;
      submitting: string;
      vatNote: string;
      disclaimer: string;
      error: string;
      successTitle: string;
      successBody: string;
      orderNumberLabel: string;
      refHint: string;
      invalidTitle: string;
      invalidBody: string;
    };
    /** M7G — anonymous new-store signup form (opened via a supplier link). */
    signup: {
      title: string;
      intro: string;
      storeName: string;
      contactName: string;
      phone: string;
      email: string;
      city: string;
      address: string;
      notes: string;
      submit: string;
      submitting: string;
      successTitle: string;
      successBody: string;
      error: string;
      invalidTitle: string;
      invalidBody: string;
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
  /** M8G.2 — customer lifecycle audit events (labels + safe details). The
   * future Customer Timeline (M8G.3) consumes these. */
  audit: {
    /** Customer audit category label. */
    category: string;
    sensitivity: { low: string; medium: string; high: string };
    /** Explicit label for an unrecognized event type (never "Other"). */
    unknownEvent: string;
    /** Closed event-type → label map (mirrors the DB allowlist). */
    events: {
      "customer.created": string;
      "customer.updated": string;
      "customer.activated": string;
      "customer.deactivated": string;
      "customer.access_link.created": string;
      "customer.access_link.rotated": string;
      "customer.access_link.revoked": string;
      "customer.order_linked": string;
    };
    /** Changed-field labels for customer.updated details. */
    fields: {
      name: string;
      contact_name: string;
      phone: string;
      city: string;
      address: string;
      customer_type: string;
      notes: string;
    };
    /** Safe detail templates (interpolated; never expose PII/tokens). */
    details: {
      origin: string;
      changed: string;
      typeChange: string;
      linkExpires: string;
      orderLinked: string;
    };
    /** M8G.3 — the read-only Customer Timeline card. */
    timeline: {
      heading: string;
      /** Legacy-honest empty state (no fabricated history). */
      empty: string;
      emptyHint: string;
      loading: string;
      loadMore: string;
      loadError: string;
      retry: string;
      /** Actor fallbacks (no display name → email is unavailable/withheld). */
      actorMember: string;
      actorFormer: string;
      actorUnknown: string;
      /** "by {actor}" attribution. */
      by: string;
    };
    /** M8H.1 — Order lifecycle audit. (The Order Timeline itself is M8H.2.) */
    order: {
      /** Order audit category label. */
      category: string;
      /** Closed Order event-type → label map (mirrors the DB allowlist). */
      events: {
        "order.created": string;
        "order.updated": string;
        "order.status_changed": string;
        "order.customer_linked": string;
      };
      /** WHO started it. A null actor is NEVER silently "System" — the channel
       * is recorded explicitly, so anonymous orders stay honest. */
      initiator: {
        authenticated_user: string;
        customer_link: string;
        showcase_guest: string;
      };
      /** Changed-field labels for order.updated (the VALUES are never shown). */
      fields: {
        items: string;
        notes: string;
      };
      /** Safe, high-level stock effect (exact quantities stay in the ledger). */
      inventoryEffect: {
        none: string;
        reserved: string;
        restored: string;
      };
      /** Safe detail templates (interpolated; never expose PII/tokens/prices). */
      details: {
        createdVia: string;
        lineCount: string;
        changed: string;
        lineCountChange: string;
        statusChange: string;
        inventory: string;
        linkedExisting: string;
        linkedGuestConversion: string;
      };
    };
  };
}
