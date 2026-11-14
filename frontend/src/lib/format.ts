export const LIGHT_COLOR: Record<string, string> = {
  green: "var(--color-canopy)",
  yellow: "var(--color-straw)",
  red: "var(--color-scorch)",
};
export const COUNTRY_COLOR = { UA: "var(--color-water)", AU: "var(--color-dusk)" } as const;
export const COUNTRY_DASH = { UA: "0", AU: "6 4" } as const;

export function num(v: number | null | undefined, digits = 1, sign = false, lang = "en") {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  const out = lang === "en" ? s : s.replace(".", ",");
  if (v < 0) return `−${out}`;
  return sign ? `+${out}` : out;
}

/** Diverging greenness colour for a z-score: brown (dry) → pale → green (lush) */
const STOPS: [number, [number, number, number]][] = [
  [-2.5, [122, 63, 18]],
  [-1.0, [196, 140, 62]],
  [-0.25, [233, 225, 196]],
  [0.25, [214, 230, 205]],
  [1.0, [120, 175, 120]],
  [2.5, [38, 96, 66]],
];
export function zColor(z: number | null) {
  if (z === null || Number.isNaN(z)) return "#d6dbd3";
  const v = Math.max(-2.5, Math.min(2.5, z));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i];
    const [b, cb] = STOPS[i + 1];
    if (v >= a && v <= b) {
      const f = (v - a) / (b - a);
      const c = ca.map((x, k) => Math.round(x + (cb[k] - x) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "#d6dbd3";
}

export function fmtDate(iso: string, lang: string) {
  const d = new Date(iso + "T00:00:00");
  const loc: Record<string, string> = { en: "en-GB", uk: "uk-UA", de: "de-DE", fr: "fr-FR", it: "it-IT" };
  return d.toLocaleDateString(loc[lang] ?? "en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Grouped integer/decimal in the user's language: 12 345,6 */
export function big(v: number | null | undefined, digits = 0, lang = "en") {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const loc: Record<string, string> = { en: "en-GB", uk: "uk-UA", de: "de-DE", fr: "fr-FR", it: "it-IT" };
  return v.toLocaleString(loc[lang] ?? "en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
