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
  getCategory,
  getManufacturer,
  getProduct,
  listCategories,
  listManufacturers,
  listProducts,
} from "./products";
export { getCustomer, listCustomers } from "./customers";
export {
  getDocument,
  getOrder,
  listDocuments,
  listDocumentsForOrder,
  listOrders,
} from "./orders";
export { getInventoryForProduct, listInventory } from "./inventory";
export { getSupplier } from "./supplier";
