"use server";
import { savePushPreferences } from "@/lib/data/push-preferences";
import { parsePushPreferences } from "@/lib/push/preferences";

export async function savePushPreferencesAction(input: unknown, scope: unknown): Promise<{ ok: boolean }> {
  const preferences = parsePushPreferences(input);
  if (!preferences || typeof scope !== "string" || !/^[a-f0-9]{64}$/.test(scope)) return { ok: false };
  try { await savePushPreferences(preferences, scope); return { ok: true }; }
  catch { return { ok: false }; } // Never expose session, DB or provider diagnostics.
}
