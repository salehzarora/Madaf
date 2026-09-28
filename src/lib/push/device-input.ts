/** Shared shapes contain no credentials. Installation IDs identify, never authorize. */
export const INSTALLATION_COOKIE = "madaf_push_installation";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FCM_TOKEN = /^[A-Za-z0-9_:\-]{20,4096}$/;
export interface DeviceInput {
  installationId: string;
  platform: "android";
  token: string;
  locale: "ar" | "he" | "en";
  enabled: boolean;
}
export function parseDeviceInput(value: unknown): DeviceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["installationId", "platform", "token", "locale", "enabled"].includes(k))) return null;
  if (typeof v.installationId !== "string" || !UUID.test(v.installationId)
    || v.platform !== "android" || typeof v.token !== "string" || !FCM_TOKEN.test(v.token)
    || !["ar", "he", "en"].includes(v.locale as string) || typeof v.enabled !== "boolean") return null;
  return v as unknown as DeviceInput;
}
export function parseInstallation(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 1 && typeof v.installationId === "string"
    && UUID.test(v.installationId) ? v.installationId : null;
}
