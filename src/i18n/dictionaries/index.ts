import type { Locale } from "../config";
import type { Dictionary } from "../types";
import ar from "./ar";
import en from "./en";
import he from "./he";

const dictionaries: Record<Locale, Dictionary> = { ar, he, en };

/**
 * Dictionaries are plain typed objects (not JSON + dynamic import) so both
 * server pages and the few client components that need full slices can use
 * them. Server pages should pass only the slices a client component needs.
 */
export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Tiny `{token}` interpolation for dictionary strings. */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

export type { Dictionary };
