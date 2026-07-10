/**
 * Shared CLIENT-side image-upload helpers (M8E.1). No server-only imports —
 * safe to import from client components. The server actions re-validate
 * everything (MIME allowlist + size + magic-byte sniff) — this only provides
 * fast local feedback so an obviously-bad file never starts an upload.
 */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Brand/company logos stay small; product photos can be larger. Mirrors the
 * MAX_*_BYTES caps re-enforced in the server actions. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Reasons an upload can be rejected — mapped to a localized message by the UI. */
export type UploadReason = "type" | "invalid" | "size" | "failed";

/**
 * Fast client-side pre-check: unsupported MIME → "type", too large → "size".
 * Returns null when the file passes the cheap checks (the server still runs the
 * authoritative magic-byte + size + role checks). Never throws.
 */
export function preValidateImage(
  file: File,
  maxBytes: number,
): UploadReason | null {
  if (!IMAGE_MIME.has(file.type)) return "type";
  if (file.size > maxBytes) return "size";
  return null;
}
