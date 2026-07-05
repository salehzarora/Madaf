/**
 * Category visual identity — one place that makes drinks LOOK like drinks
 * and cleaning look like cleaning across the whole app (cards, chips,
 * landing tiles). Patterns are drawn by <ProductImage>; classes here are
 * full literal strings so Tailwind can see them.
 */
export type CategoryPattern =
  | "bubbles" // drinks — rising carbonation
  | "confetti" // snacks — crumbs & party
  | "beans" // coffee — bean ellipses
  | "rings" // canned — can tops
  | "waves" // dairy — milk waves
  | "sparkles"; // cleaning — clean shine

export interface CategoryStyle {
  /** Gradient stops for placeholder art (CSS colors). */
  from: string;
  to: string;
  /** Pattern drawn over the gradient. */
  pattern: CategoryPattern;
  /** Pattern ink color (with opacity) for the SVG overlay. */
  patternColor: string;
  /** Idle (unselected) category chip — soft tinted. */
  chipIdle: string;
  /** Selected category chip — solid, confident. */
  chipSelected: string;
  /** Landing tile background + hover. */
  tile: string;
  /** Accent text (e.g. tile labels). */
  text: string;
}

const styles: Record<string, CategoryStyle> = {
  "cat-drinks": {
    from: "#d7ecf7",
    to: "#9ccde8",
    pattern: "bubbles",
    patternColor: "rgba(255,255,255,0.55)",
    chipIdle:
      "border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-400",
    chipSelected: "border-sky-700 bg-sky-700 text-white",
    tile: "bg-sky-50 hover:bg-sky-100 border-sky-200",
    text: "text-sky-900",
  },
  "cat-snacks": {
    from: "#fde8c8",
    to: "#f6bf78",
    pattern: "confetti",
    patternColor: "rgba(255,255,255,0.6)",
    chipIdle:
      "border-orange-200 bg-orange-50 text-orange-900 hover:border-orange-400",
    chipSelected: "border-orange-600 bg-orange-600 text-white",
    tile: "bg-orange-50 hover:bg-orange-100 border-orange-200",
    text: "text-orange-900",
  },
  "cat-coffee": {
    from: "#e8d9c8",
    to: "#c19a6b",
    pattern: "beans",
    patternColor: "rgba(80,50,25,0.25)",
    chipIdle:
      "border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-500",
    chipSelected: "border-amber-800 bg-amber-800 text-white",
    tile: "bg-amber-50 hover:bg-amber-100 border-amber-200",
    text: "text-amber-950",
  },
  "cat-canned": {
    from: "#fadcd4",
    to: "#f0a08c",
    pattern: "rings",
    patternColor: "rgba(255,255,255,0.5)",
    chipIdle:
      "border-red-200 bg-red-50 text-red-900 hover:border-red-400",
    chipSelected: "border-red-700 bg-red-700 text-white",
    tile: "bg-red-50 hover:bg-red-100 border-red-200",
    text: "text-red-900",
  },
  "cat-dairy": {
    from: "#eef3fa",
    to: "#bcd2ee",
    pattern: "waves",
    patternColor: "rgba(255,255,255,0.7)",
    chipIdle:
      "border-blue-200 bg-blue-50 text-blue-900 hover:border-blue-400",
    chipSelected: "border-blue-700 bg-blue-700 text-white",
    tile: "bg-blue-50 hover:bg-blue-100 border-blue-200",
    text: "text-blue-900",
  },
  "cat-cleaning": {
    from: "#d9f2e8",
    to: "#8fd8c0",
    pattern: "sparkles",
    patternColor: "rgba(255,255,255,0.65)",
    chipIdle:
      "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400",
    chipSelected: "border-emerald-700 bg-emerald-700 text-white",
    tile: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
    text: "text-emerald-900",
  },
};

const fallback: CategoryStyle = {
  from: "#ece9e4",
  to: "#cfc9c0",
  pattern: "rings",
  patternColor: "rgba(255,255,255,0.5)",
  chipIdle:
    "border-line-strong bg-surface text-ink-soft hover:border-brand-300",
  chipSelected: "border-brand-600 bg-brand-600 text-white",
  tile: "bg-surface-sunken hover:bg-line border-line",
  text: "text-ink",
};

export function categoryStyle(categoryId: string): CategoryStyle {
  return styles[categoryId] ?? fallback;
}
