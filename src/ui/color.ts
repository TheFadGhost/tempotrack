/**
 * Per-theme project palettes, mirrored from src/styles/tokens.css.
 * tests/design/tokens.test.ts asserts the two never drift apart.
 */
export const PROJECT_PALETTES: Record<"light" | "dark" | "dim" | "highContrast", string[]> = {
  light: ["#265aba", "#2c7d80", "#876200", "#d8692c", "#7062ad", "#8b1768", "#6c8e44", "#445160"],
  dark: ["#587fc2", "#7dd5d7", "#bf9d3c", "#ffc18f", "#efdeff", "#b6669d", "#a7c67c", "#9aa7b4"],
  dim: ["#778caf", "#a3d6cf", "#b79e5f", "#ffd4b1", "#b1a5cd", "#ae7d95", "#b5c79b", "#676e73"],
  highContrast: ["#678dc6", "#76efef", "#d4ac05", "#ffd79c", "#faefff", "#de84b2", "#bbec88", "#bec7d2"],
};

export type ThemeName = keyof typeof PROJECT_PALETTES;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const lin = [r!, g!, b!].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrast(aLum: number, bLum: number): number {
  const [hi, lo] = aLum >= bLum ? [aLum, bLum] : [bLum, aLum];
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_INK = "#101114";
const LIGHT_INK = "#ffffff";

/**
 * Picks black or white label ink for text sitting on the given fill, whichever
 * contrasts more. For any fill colour the better of black/white is always
 * >= 4.5:1 (worst case at the crossover luminance is ~4.58:1), so block
 * labels stay AA on every project colour in every theme.
 */
export function readableInkOn(fillHex: string): string {
  const y = relativeLuminance(fillHex);
  return contrast(y, relativeLuminance(DARK_INK)) >= contrast(y, relativeLuminance(LIGHT_INK))
    ? DARK_INK
    : LIGHT_INK;
}

export function paletteForTheme(theme: string | undefined): string[] {
  return PROJECT_PALETTES[(theme ?? "light") as ThemeName] ?? PROJECT_PALETTES.light!;
}
