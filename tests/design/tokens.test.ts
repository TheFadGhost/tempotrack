import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { paletteForTheme, readableInkOn } from "../../src/ui/color.js";

interface Rgb { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio. */
export function contrast(aHex: string, bHex: string): number {
  const la = relativeLuminance(hexToRgb(aHex));
  const lb = relativeLuminance(hexToRgb(bHex));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Viénot et al. deuteranopia simulation in linear RGB. */
export function simulateDeuteranopia(hex: string): Rgb {
  const { r, g, b } = hexToRgb(hex);
  const [rl, gl, bl] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const sim = {
    rl: 0.625 * rl + 0.375 * gl,
    gl: 0.7 * gl + 0.3 * rl,
    bl,
  };
  const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  return { r: toSrgb(sim.rl), g: toSrgb(sim.gl), b: toSrgb(sim.bl) };
}

function toLab(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  const lin = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const X = 0.4124 * lin[0]! + 0.3576 * lin[1]! + 0.1805 * lin[2]!;
  const Y = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  const Z = 0.0193 * lin[0]! + 0.1192 * lin[1]! + 0.9505 * lin[2]!;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(aHex: string, bHex: string): number {
  const a = toLab(aHex);
  const b = toLab(bHex);
  return Math.sqrt((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2);
}

function deltaEDeutan(aHex: string, bHex: string): number {
  const a = toLabDeutan(simulateDeuteranopia(aHex));
  const b = toLabDeutan(simulateDeuteranopia(bHex));
  return Math.sqrt((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2);
}

function toLabDeutan({ r, g, b }: Rgb): [number, number, number] {
  const lin = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const X = 0.4124 * lin[0]! + 0.3576 * lin[1]! + 0.1805 * lin[2]!;
  const Y = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  const Z = 0.0193 * lin[0]! + 0.1192 * lin[1]! + 0.9505 * lin[2]!;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const TOKENS_CSS = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

const THEMES = ["light", "dark", "dim", "highContrast"] as const;

function themeBlock(theme: string): string {
  const marker = theme === "light" ? ':root, :root[data-theme="light"]' : `:root[data-theme="${theme}"]`;
  const start = TOKENS_CSS.indexOf(marker);
  if (start === -1) throw new Error(`theme ${theme} missing`);
  const end = TOKENS_CSS.indexOf("\n}", start);
  return TOKENS_CSS.slice(start, end);
}

function token(theme: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(themeBlock(theme));
  if (!m) throw new Error(`token --${name} not found in ${theme}`);
  return m[1]!;
}

describe("theme tokens meet accessibility thresholds", () => {
  for (const theme of THEMES) {
    it(`${theme}: text and metadata reach AA contrast`, () => {
      const bg = token(theme, "bg");
      expect(contrast(token(theme, "ink"), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(theme, "ink-muted"), bg)).toBeGreaterThanOrEqual(4.5);
      // Chart axis labels use ink-muted; verify against surface too.
      expect(contrast(token(theme, "ink-muted"), token(theme, "surface"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: focus ring, status colours and ramp top are visible (>=3:1)`, () => {
      const bg = token(theme, "bg");
      expect(contrast(token(theme, "focus-ring"), bg)).toBeGreaterThanOrEqual(3);
      for (const role of ["ok", "warn", "danger"]) {
        expect(contrast(token(theme, role), bg)).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(token(theme, "chart-ramp-5"), token(theme, "surface"))).toBeGreaterThanOrEqual(3);
    });

    it(`${theme}: all 8 project colours clear >=3:1 against the background`, () => {
      const bg = token(theme, "bg");
      for (let i = 1; i <= 8; i++) {
        expect(contrast(token(theme, `project-${i}`), bg)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme}: block labels on project colours reach AA via readable ink pick`, () => {
      const palette = paletteForTheme(theme);
      for (let i = 1; i <= 8; i++) {
        const fill = token(theme, `project-${i}`);
        expect(fill.toLowerCase()).toBe(palette[i - 1]!.toLowerCase());
        const ink = readableInkOn(fill);
        const ratio = contrast(ink, fill);
        if (ratio < 4.5) {
          throw new Error(`${theme}: chosen ink vs project-${i} is ${ratio.toFixed(2)}, needs >= 4.5`);
        }
      }
    });

    it(`${theme}: project palette stays distinguishable under deuteranopia`, () => {
      const violations: string[] = [];
      for (let a = 1; a <= 8; a++) {
        for (let b = a + 1; b <= 8; b++) {
          const d = deltaEDeutan(token(theme, `project-${a}`), token(theme, `project-${b}`));
          if (d <= 12) violations.push(`project-${a} vs project-${b}: ${d.toFixed(1)}`);
        }
      }
      expect(violations, `${theme} deutan collisions: ${violations.join("; ")}`).toEqual([]);
    });
  }

  it("every theme defines a complete token set", () => {
    const required = [
      "bg","surface","surface-2","ink","ink-muted","ink-faint","line","focus-ring",
      "ok","warn","danger","chart-ramp-1","chart-ramp-2","chart-ramp-3","chart-ramp-4","chart-ramp-5",
      ...Array.from({ length: 8 }, (_, i) => `project-${i + 1}`),
    ];
    for (const theme of THEMES) {
      for (const name of required) {
        expect(token(theme, name)).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
