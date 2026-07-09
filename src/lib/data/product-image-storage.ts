import "server-only";

/**
 * M7I.4 — dedicated SERVER-ONLY service-role client for signing private
 * product-image objects (and resolving the owning tenant by token_hash) for
 * token-validated shop/showcase viewers.
 *
 * WHY a separate client: the customer-facing image signing used to borrow the
 * DOCUMENT-PDF trusted client (getTrustedDocumentStorageClient), which is
 * fail-closed behind `MADAF_TRUSTED_DOCUMENT_STORAGE=enabled` + a strict
 * `<ref>.supabase.co` host pin — guards meant for stored PDFs, unrelated to
 * product images. On hosted, unless that unrelated subsystem was enabled AND
 * the ref/host matched exactly AND the flag string was exact, every uploaded
 * image silently rendered as a placeholder. This client needs ONLY the URL +
 * the server-only service-role key, so uploaded images render as soon as the
 * key is set (which the app already needs).
 *
 * Security: `import "server-only"`; refuses to run in the browser; the key is
 * read from a NON-public env var and is NEVER exposed to the client. Signing
 * still targets ONLY objects under `<tenant_id>/products/` (see
 * signOwnTenantPaths) and still fail-closes to placeholders if the key is
 * absent (the caller catches). RLS is not weakened — this is used purely to
 * SIGN already-authorized, tenant-scoped, own-product objects server-side.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

let cached: SupabaseClient<Database> | undefined;

export function getProductImageStorageClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "[madaf/img] the product-image storage client must never run in the " +
        "browser — the service-role key bypasses RLS.",
    );
  }
  if (cached) return cached;

  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "[madaf/img] SUPABASE_SERVICE_ROLE_KEY is required (server env only, " +
        "never NEXT_PUBLIC) to sign private product images for the shop/" +
        "showcase. Without it, uploaded images fall back to placeholders.",
    );
  }
  cached = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
