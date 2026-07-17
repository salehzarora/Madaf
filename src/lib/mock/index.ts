/**
 * Mock data barrel — demo DATA only (see docs/MVP_SCOPE.md).
 *
 * M2 rules: UI code must not import this barrel — only src/lib/data does
 * (reads go through the data layer on the server; client components get
 * props/context). Pure helpers live in src/lib/catalog-helpers.ts.
 */
export { supplier } from "./supplier";
export { categories, categoryById } from "./categories";
export { manufacturers, manufacturerById } from "./manufacturers";
export { products, productById } from "./products";
export { customers, customerById } from "./customers";
export { orders, orderById } from "./orders";
export { inventory, inventoryByProductId } from "./inventory";
export { documents, documentById } from "./documents";
export {
  auditEvents,
  auditActors,
  orderAuditEvents,
  productAuditEvents,
  inventoryAuditEvents,
  teamAuditEvents,
  type MockAuditEvent,
  type MockOrderAuditEvent,
  type MockProductAuditEvent,
  type MockInventoryAuditEvent,
  type MockTeamAuditEvent,
} from "./audit-events";
