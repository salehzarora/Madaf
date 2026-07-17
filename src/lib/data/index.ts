/**
 * Data access layer — the seam between the UI and whatever backs it.
 *
 * M2 state: every UI read goes through these async functions. Server
 * components await them directly; client components receive results as
 * props (or via ShopDataProvider) and never fetch. Mock mode is the
 * default and needs zero configuration; supabase mode is a local-dev,
 * read-only, server-side branch (see ./supabase-reads).
 */
export { getDataMode, type DataMode } from "./mode";
export {
  createManufacturer,
  createProduct,
  getCategory,
  getManufacturer,
  getProduct,
  listCategories,
  listManufacturers,
  listProducts,
  listProductsForExport,
  searchProducts,
  setProductActive,
  updateManufacturer,
  updateProduct,
  uploadManufacturerLogo,
  uploadProductImage,
  upsertInventory,
  type InventoryWriteInput,
  type ManufacturerWriteInput,
  type ProductWriteInput,
} from "./products";
export {
  createCustomer,
  getCustomer,
  getCustomerStatsForIds,
  listCustomers,
  searchCustomers,
  setCustomerActive,
  updateCustomer,
  CUSTOMER_STATS_MAX_IDS,
  type CustomerRowStat,
  type CustomerWriteInput,
} from "./customers";
export {
  getOrderDocumentSource,
  recordOrderDocument,
  signStoredDocument,
  storeDocumentPdf,
} from "./documents";
export {
  createCustomerFromOrder,
  createOrderRequest,
  getDocument,
  getOrder,
  linkOrderToCustomer,
  listDocuments,
  listDocumentsForOrder,
  listOrders,
  listOrdersForExport,
  searchOrders,
  updateOrderItems,
  updateOrderStatus,
  type CreateOrderInput,
  type CreateOrderResult,
  type OrderSource,
} from "./orders";
export {
  adjustInventoryStock,
  getInventoryForProduct,
  getMovementActorLabels,
  listInventory,
  listInventoryMovements,
  searchInventoryMovements,
} from "./inventory";
export {
  getSupplier,
  getTenantTimeZone,
  updateTenantProfile,
  updateTenantTimeZone,
  uploadTenantLogo,
  type TenantProfileInput,
} from "./supplier";
export {
  getCustomerTimelinePage,
  getTimelineActorLabelsForIds,
  safeInitialCustomerTimeline,
  type TimelineQuery,
} from "./customer-timeline";
export {
  getOrderTimelinePage,
  safeInitialOrderTimeline,
  type OrderTimelineQuery,
} from "./order-timeline";
export {
  getProductTimelinePage,
  safeInitialProductTimeline,
  type ProductTimelineQuery,
} from "./product-timeline";
export {
  getInventoryTimelinePage,
  safeInitialInventoryTimeline,
  type InventoryTimelineQuery,
} from "./inventory-timeline";
export {
  getTeamTimelinePage,
  safeInitialTeamTimeline,
  type TeamTimelineQuery,
} from "./team-timeline";
export {
  getSettingsTimelinePage,
  safeInitialSettingsTimeline,
  type SettingsTimelineQuery,
} from "./settings-timeline";
export {
  computeDashboardMetrics,
  getDashboardMetrics,
  type DashboardMetrics,
  type DashboardMetricsInput,
} from "./dashboard";
