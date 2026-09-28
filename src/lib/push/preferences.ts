export const preferenceKeys = ["new_order", "signup_request", "low_stock", "order_status"] as const;
export type PushPreferences = Record<(typeof preferenceKeys)[number], boolean>;
export const defaultPushPreferences: PushPreferences = {
  new_order: true, signup_request: true, low_stock: true, order_status: false,
};

/** Strict allowlist: neither user nor tenant IDs are accepted from a browser. */
export function parsePushPreferences(input: unknown): PushPreferences | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== preferenceKeys.length
    || preferenceKeys.some(key => typeof value[key] !== "boolean")) return null;
  return Object.fromEntries(preferenceKeys.map(key => [key, value[key]])) as PushPreferences;
}
