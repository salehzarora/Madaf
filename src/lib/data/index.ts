/**
 * Data access layer — the seam between the UI and whatever backs it.
 *
 * M1 state: every function is mock-backed and async. The M0 pages still
 * import src/lib/mock directly (unchanged by design); in M2 they switch to
 * these functions and ONLY the bodies here change to Supabase queries —
 * component code stays identical. See docs/FUTURE_BACKEND_HANDOFF.md.
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
export { getDocument, getOrder, listDocuments, listOrders } from "./orders";
export { getInventoryForProduct, listInventory } from "./inventory";
export { getSupplier } from "./supplier";
