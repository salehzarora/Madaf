/**
 * PILOT-OPS-AUDIT-008-FIX2 — persistent submission keys for the token order flows.
 *
 * The DATABASE is the authoritative order idempotency boundary (a claim keyed by
 * (tenant, channel, submission_key)). This client-only helper makes the browser
 * present the SAME submission key across a refresh / component remount / route
 * remount / an ambiguous response — so a retry of the same logical order is
 * recognized by the database as the same submission, not a new one.
 *
 * BROWSER-ONLY. No server-only import, no Supabase, no database access. It never
 * stores, logs, or exposes the raw token: the storage namespace is scoped by a
 * SHA-256 digest of the token (a LOCAL namespace only — never an auth/authz value
 * and never the database request fingerprint). The stored value is ONLY the
 * submission UUID + a version marker — never cart, PII, payload, or order data.
 *
 * FAIL-CLOSED: when sessionStorage cannot be read/written/verified, the helper
 * returns { ok: false } so the caller can refuse to submit (a silent volatile key
 * would reintroduce the duplicate-order risk after a refresh).
 *
 * Scope: sessionStorage is tab/session-scoped, so two intentionally separate tabs
 * are two separate logical orders. Cross-tab dedup is NOT provided (the database
 * claim still prevents any true duplicate for a given key).
 */

const STORAGE_VERSION = 1;
const NS_PREFIX = `madaf:order-submission:v${STORAGE_VERSION}`;
const PROBE_KEY = `${NS_PREFIX}:__probe__`;

export type OrderTokenChannel = "shop_token" | "showcase";
const CHANNELS: readonly OrderTokenChannel[] = ["shop_token", "showcase"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A submission key, or a fail-closed reason (never a silent volatile fallback). */
export type SubmissionKeyResult =
  | { ok: true; key: string }
  | { ok: false; reason: "storage" | "channel" };

/** SHA-256 hex of the token — the storage NAMESPACE scope only. Not the DB
 * fingerprint, not an auth value; the real token continues through the existing
 * authorized RPC path unchanged. */
async function tokenScope(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function namespaceKey(
  channel: OrderTokenChannel,
  token: string,
): Promise<string> {
  return `${NS_PREFIX}:${channel}:${await tokenScope(token)}`;
}

/** Return sessionStorage only if a write→read-back probe succeeds; else null.
 * Guards SSR, privacy mode, disabled storage and quota-on-probe failures. */
function verifiedSession(): Storage | null {
  try {
    const s = window.sessionStorage;
    s.setItem(PROBE_KEY, "1");
    const ok = s.getItem(PROBE_KEY) === "1";
    s.removeItem(PROBE_KEY);
    return ok ? s : null;
  } catch {
    return null;
  }
}

/** Parse a stored record and return its UUID only if it is well-formed. */
function readStoredKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; k?: unknown };
    if (typeof parsed.k === "string" && UUID_RE.test(parsed.k)) return parsed.k;
  } catch {
    /* malformed record → treated as absent */
  }
  return null;
}

/**
 * Return the persisted submission key for (channel, token), generating and
 * persisting a fresh one only when none is stored. Verifies the write is
 * readable back; fails closed (no key) if storage is unavailable.
 */
export async function getOrCreateTokenSubmissionKey(
  channel: OrderTokenChannel,
  token: string,
): Promise<SubmissionKeyResult> {
  if (!CHANNELS.includes(channel)) return { ok: false, reason: "channel" };
  const s = verifiedSession();
  if (!s) return { ok: false, reason: "storage" };
  try {
    const nsKey = await namespaceKey(channel, token);
    const existing = readStoredKey(s.getItem(nsKey));
    if (existing) return { ok: true, key: existing };
    const key = crypto.randomUUID();
    s.setItem(nsKey, JSON.stringify({ v: STORAGE_VERSION, k: key }));
    // Verify the key actually persisted before the caller relies on it.
    if (readStoredKey(s.getItem(nsKey)) !== key) return { ok: false, reason: "storage" };
    return { ok: true, key };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

/** Read-only: the persisted key without generating one — used to confirm a key is
 * RETAINED (e.g. after an ambiguous failure). Returns null if absent/unavailable. */
export async function retainTokenSubmissionKey(
  channel: OrderTokenChannel,
  token: string,
): Promise<string | null> {
  const s = verifiedSession();
  if (!s) return null;
  try {
    return readStoredKey(s.getItem(await namespaceKey(channel, token)));
  } catch {
    return null;
  }
}

/** Drop the persisted key (best-effort) — after a confirmed success. */
export async function clearTokenSubmissionKey(
  channel: OrderTokenChannel,
  token: string,
): Promise<void> {
  try {
    window.sessionStorage.removeItem(await namespaceKey(channel, token));
  } catch {
    /* best-effort */
  }
}

/** Rotate to a fresh persisted key — for an explicit new order attempt. */
export async function rotateTokenSubmissionKey(
  channel: OrderTokenChannel,
  token: string,
): Promise<SubmissionKeyResult> {
  await clearTokenSubmissionKey(channel, token);
  return getOrCreateTokenSubmissionKey(channel, token);
}
