import "server-only";

/**
 * M5C — dedicated TRUSTED client for document-PDF storage (SERVER ONLY).
 *
 * The `documents` bucket has NO authenticated storage policies (M5B.1), so
 * only the service role can write/read its objects — and only AFTER the
 * route has authorized the request (RLS order read + create_order_document +
 * set_document_storage). This module owns that one trusted client, kept
 * SEPARATE from the generic local-dev/bootstrap `getServiceContext`
 * (supabase-context.ts) so document storage has an explicit, minimal
 * production-readiness model.
 *
 * Config model (env, server-only — NEVER NEXT_PUBLIC):
 *   MADAF_TRUSTED_DOCUMENT_STORAGE = "local-only" (default) | "enabled"
 *   MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF = "<ref>"   (required for a
 *       hosted URL when enabled — pins the URL to <ref>.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY = <server-only key>          (always required)
 *
 * Safe by default / fail-closed:
 *   - "local-only" (default): refuses NODE_ENV=production and any non-local
 *     Supabase URL — identical posture to M5B. Mock mode never reaches here.
 *   - "enabled" (explicit opt-in): permits a hosted URL, but ONLY when it
 *     matches the configured project ref (`<ref>.supabase.co`); a hosted URL
 *     without a ref is refused, so it can never point at an arbitrary project.
 *   - Any misconfiguration throws → the route streams the freshly-rendered
 *     PDF without storing (graceful fallback), never leaking or erroring.
 *
 * The service-role key bypasses RLS; it is read from a NON-public env var,
 * this module is `server-only`, and it must never reach the browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type StorageMode = "local-only" | "enabled";

function storageMode(): StorageMode {
  return process.env.MADAF_TRUSTED_DOCUMENT_STORAGE === "enabled"
    ? "enabled"
    : "local-only";
}

let cached: SupabaseClient<Database> | undefined;

/**
 * The trusted document-storage client, or throws if unavailable/misconfigured
 * (the caller catches → falls back to streaming). Never runs in the browser.
 */
export function getTrustedDocumentStorageClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "[madaf/pdf] trusted document storage must never run in the browser — " +
        "the service-role key bypasses RLS.",
    );
  }
  if (cached) return cached;

  const { url } = getSupabaseEnv();
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(
      `[madaf/pdf] NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${url}".`,
    );
  }
  const isLocal = LOCAL_HOSTNAMES.has(hostname);
  const mode = storageMode();

  if (mode === "local-only") {
    // Safe default (M5B posture): local dev only, fail closed otherwise.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[madaf/pdf] trusted document storage is local-only by default. To " +
          "enable stored PDFs in production, set MADAF_TRUSTED_DOCUMENT_STORAGE" +
          "=enabled and MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF=<ref> " +
          "(server env). See docs/security/AUDIT_NOTES.md / supabase/README.md.",
      );
    }
    if (!isLocal) {
      throw new Error(
        "[madaf/pdf] local-only trusted document storage refuses a non-local " +
          `Supabase URL ("${url}"). Point it at http://127.0.0.1:55321 or opt ` +
          "in with MADAF_TRUSTED_DOCUMENT_STORAGE=enabled + a project ref.",
      );
    }
  } else {
    // Explicit production opt-in: a hosted URL MUST match the pinned ref.
    // Lowercase both sides (the hostname is already lowercased) so a
    // mixed-case ref still matches — the compare stays exact/fail-closed.
    const ref = process.env.MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF?.trim().toLowerCase();
    if (!isLocal) {
      if (!ref) {
        throw new Error(
          "[madaf/pdf] MADAF_TRUSTED_DOCUMENT_STORAGE=enabled with a hosted " +
            "URL requires MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF to pin " +
            "the expected project — refusing to point at an arbitrary project.",
        );
      }
      const expectedHost = `${ref}.supabase.co`;
      if (hostname !== expectedHost) {
        throw new Error(
          `[madaf/pdf] trusted storage URL host "${hostname}" does not match ` +
            `the configured project ref host "${expectedHost}".`,
        );
      }
    }
    // A local URL in "enabled" mode is allowed (local testing of the opt-in).
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "[madaf/pdf] SUPABASE_SERVICE_ROLE_KEY is required for trusted document " +
        "storage (server env only — never NEXT_PUBLIC, never in the browser).",
    );
  }

  cached = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
