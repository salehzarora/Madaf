/**
 * Phone-number normalization to E.164 (M7B). Shared by the client (light
 * validation / UX) and the server actions (authoritative). No secrets, no
 * side effects — safe in the client bundle.
 *
 * Rules (generic, with an Israeli convenience):
 *  - Strips spaces, dashes, parens, etc.
 *  - `00<cc>…` → `+<cc>…` (international prefix form).
 *  - A leading `0` with no `+` is treated as an Israeli local number and
 *    rewritten to `+972…` (e.g. `050-000-0000` → `+972500000000`).
 *  - Otherwise a leading `+` is required/added.
 *  - Result must match E.164: `+` then 8–15 digits, first digit non-zero.
 *
 * Returns the normalized `+…` string, or `null` when it is not a plausible
 * E.164 number.
 */
export function normalizePhoneE164(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.length === 0) return null;

  // Keep digits and a single leading plus only.
  const hadPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (s.length === 0) return null;

  if (!hadPlus && s.startsWith("00")) {
    // 00<cc> international form → +<cc>
    s = s.slice(2);
  } else if (!hadPlus && s.startsWith("0")) {
    // Israeli local convenience: 0XXXXXXXXX → 972XXXXXXXXX
    s = `972${s.slice(1)}`;
  }

  const candidate = `+${s}`;
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}

/** Cheap client-side plausibility check (does not guarantee deliverability). */
export function looksLikePhone(raw: string): boolean {
  return normalizePhoneE164(raw) !== null;
}
