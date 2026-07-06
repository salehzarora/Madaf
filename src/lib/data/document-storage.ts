import "server-only";

/**
 * M5B — private document PDF storage + signed-URL delivery (SERVER ONLY).
 *
 * PDFs live in the PRIVATE `documents` bucket under a tenant-scoped path
 * `<tenant_id>/documents/<order_id>/<document_type>/<document_id>_<locale>.pdf`
 * — no token_hash, secret, or raw token in the path. Upload + signing run on
 * the authenticated cookie client, so the storage.objects policies
 * (can_access_order on the tenant + order path segments) gate them: a
 * sales_rep can only sign/upload for assigned-customer orders, owner/admin
 * for any tenant order, non-member/anon nothing. The storage metadata is
 * recorded through the set_document_storage RPC (documents stay read-only).
 *
 * Reached only through the data layer — never from client code.
 */
import { getDataContext } from "@/lib/auth/session";

import { sbSetDocumentStorage } from "./supabase-writes";

const DOCUMENTS_BUCKET = "documents";
/** Signed URLs are short-lived: they are handed only to the authorized
 * caller who just passed the access check, for an immediate download. */
const SIGNED_URL_TTL_SECONDS = 60;

type DbDocumentType = "order_request" | "delivery_note" | "invoice_draft";

function objectPath(
  tenantId: string,
  orderId: string,
  dbType: DbDocumentType,
  documentId: string,
  locale: string,
): string {
  return `${tenantId}/documents/${orderId}/${dbType}/${documentId}_${locale}.pdf`;
}

/**
 * Create a short-lived signed URL for an ALREADY-stored document object, or
 * null if it does not exist yet / the caller may not sign it (storage RLS).
 * Used for the reuse path (skip regeneration when a stored PDF exists).
 */
export async function sbSignDocument(input: {
  orderId: string;
  dbType: DbDocumentType;
  documentId: string;
  locale: string;
  filename: string;
}): Promise<string | null> {
  const { client, tenantId } = await getDataContext();
  const path = objectPath(
    tenantId,
    input.orderId,
    input.dbType,
    input.documentId,
    input.locale,
  );
  const { data, error } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: input.filename });
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Upload (upsert) the PDF to the private bucket, record its storage metadata
 * via the RPC, and return a short-lived signed URL. Returns null if the
 * upload/sign failed (the caller falls back to streaming the bytes).
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
  const { client, tenantId } = await getDataContext();
  const path = objectPath(
    tenantId,
    input.orderId,
    input.dbType,
    input.documentId,
    input.locale,
  );

  const { error: uploadError } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, input.bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    console.error("[madaf/pdf] document upload failed:", uploadError.message);
    return null;
  }

  await sbSetDocumentStorage({
    documentId: input.documentId,
    storagePath: path,
    fileSizeBytes: input.bytes.byteLength,
    checksum: input.checksum,
  });

  const { data, error } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: input.filename });
  if (error || !data) return null;
  return data.signedUrl;
}
