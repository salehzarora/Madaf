import "server-only";

/**
 * M5B/M5B.1 — private document PDF storage + signed-URL delivery
 * (SERVER ONLY, TRUSTED SERVER PATH).
 *
 * PDFs live in the PRIVATE `documents` bucket under a path derived entirely
 * from the document row:
 *   `<tenant_id>/documents/<order_id>/<document_type>/<document_id>_<locale>.pdf`
 * — no token_hash / secret / raw token.
 *
 * M5B.1 hardening: normal authenticated users can NO LONGER upload, read, or
 * overwrite objects in this bucket (the storage.objects policies were
 * dropped), which closes the M5B forgery vector (a user with can_access_order
 * could upload a fake PDF at the deterministic path). Upload + signing now run
 * on the TRUSTED, server-only service-role client
 * (`getTrustedDocumentStorageClient`, M5C — a DEDICATED document-storage
 * client with an explicit local-only-by-default / opt-in-for-production model;
 * server-only, key from a non-public env var, never in a client bundle).
 * ACCESS IS STILL VERIFIED via the authenticated context BEFORE any
 * service-role op: the route reads the order under RLS (`can_access_order` →
 * 404) and records via `create_order_document`; recording the storage metadata
 * goes through the `set_document_storage` RPC on the AUTHENTICATED client,
 * which re-checks access AND validates the exact expected path. The service
 * role is used only to write/sign that already-authorized object. Reached only
 * through the data layer — never from client code.
 */
import { getDataContext } from "@/lib/auth/session";

import { sbSetDocumentStorage } from "./supabase-writes";
import { getTrustedDocumentStorageClient } from "./trusted-document-storage";

const DOCUMENTS_BUCKET = "documents";
/** Signed URLs are short-lived: handed only to the authorized caller who just
 * passed the access checks, for an immediate download. */
const SIGNED_URL_TTL_SECONDS = 60;

type DbDocumentType = "order_request" | "delivery_note" | "invoice_draft";

/** The ONE valid object path — matches set_document_storage's DB-derived path. */
function objectPath(
  tenantId: string,
  orderId: string,
  dbType: DbDocumentType,
  documentId: string,
  locale: string,
): string {
  return `${tenantId}/documents/${orderId}/${dbType}/${documentId}_${locale}.pdf`;
}

/** Trusted, server-only document-storage client (fail-closed). Returns null if
 * unavailable/misconfigured (no service key, production without opt-in, wrong
 * project ref, …) so the caller gracefully falls back to streaming the
 * freshly-rendered bytes. */
function serviceStorage() {
  try {
    return getTrustedDocumentStorageClient().storage;
  } catch (error) {
    console.error("[madaf/pdf] trusted storage client unavailable:", error);
    return null;
  }
}

/**
 * Reuse path: sign an ALREADY-stored object ONLY when the recorded
 * `storage_path` is exactly the expected DB-derived path for this order /
 * type / document / locale (so a stale or unexpected path is never trusted).
 * Signing uses the trusted service client. Returns null → the route should
 * regenerate through the trusted upload path.
 */
export async function sbSignStoredDocument(input: {
  orderId: string;
  dbType: DbDocumentType;
  documentId: string;
  locale: string;
  storedPath: string | null;
  filename: string;
}): Promise<string | null> {
  const { tenantId } = await getDataContext();
  const expected = objectPath(
    tenantId,
    input.orderId,
    input.dbType,
    input.documentId,
    input.locale,
  );
  // Never reuse an object at a path that isn't the exact expected one.
  if (!input.storedPath || input.storedPath !== expected) return null;

  const storage = serviceStorage();
  if (!storage) return null;
  const { data, error } = await storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(expected, SIGNED_URL_TTL_SECONDS, {
      download: input.filename,
    });
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Upload (upsert) the PDF via the TRUSTED service client, record its metadata
 * via the set_document_storage RPC (authenticated → access + exact-path
 * check), and return a short-lived signed URL. Returns null if storage is
 * unavailable / failed, so the caller streams the bytes it already has.
 */
export async function sbStoreDocument(input: {
  orderId: string;
  dbType: DbDocumentType;
  documentId: string;
  locale: string;
  filename: string;
  bytes: Uint8Array;
  checksum: string;
}): Promise<string | null> {
  // Tenant comes from the authenticated session (never the pinned service
  // tenant); the route already verified order access for this tenant.
  const { tenantId } = await getDataContext();
  const storage = serviceStorage();
  if (!storage) return null;

  const path = objectPath(
    tenantId,
    input.orderId,
    input.dbType,
    input.documentId,
    input.locale,
  );

  const { error: uploadError } = await storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, input.bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    console.error("[madaf/pdf] document upload failed:", uploadError.message);
    return null;
  }

  try {
    // Record the metadata on the AUTHENTICATED client: the RPC re-verifies
    // access AND that this path is exactly the DB-derived expected path. The
    // route builds that same path, so this always matches; on any failure we
    // fall back to streaming (return null) rather than erroring the download.
    await sbSetDocumentStorage({
      documentId: input.documentId,
      storagePath: path,
      fileSizeBytes: input.bytes.byteLength,
      checksum: input.checksum,
    });

    const { data, error } = await storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
        download: input.filename,
      });
    if (error || !data) return null;
    return data.signedUrl;
  } catch (error) {
    console.error("[madaf/pdf] document metadata/sign failed:", error);
    return null;
  }
}
