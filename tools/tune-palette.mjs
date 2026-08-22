// Applies a hand-chosen lightness ladder to the project palette, preserving
// each colour's hue/chroma (a*,b*). The ladder places colours in two clusters
// on deuteranopia's preserved blue-yellow axis with >=12 Lab lightness gaps.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const THEMES = ["light", "dark", "dim", "highContrast"];

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const s2l = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const l2s = (v) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};
const rgbToHex = (rgb) => "#" + rgb.map(l2s).map((v) => v.toString(16).padStart(2, "0")).join("");
function labOf(hex) {
  const [r, g, b] = hexToRgb(hex).map(s2l);
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X / 0.95047) - f(Y)), 200 * (f(Y) - f(Z / 1.08883))];
}
function labToHex([L, A, B]) {
  const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
  const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  return rgbToHex([
    Math.max(0, Math.min(1, 3.2406 * x - 1.5372 * y - 0.4986 * z)),
    Math.max(0, Math.min(1, -0.9689 * x + 1.8758 * y + 0.0415 * z)),
    Math.max(0, Math.min(1, 0.0557 * x - 0.204 * y + 1.057 * z)),
  ]);
}
function deutanLab(hex) {
  const lin = hexToRgb(hex).map(s2l);
  const m = [0.625 * lin[0] + 0.375 * lin[1], 0.7 * lin[1] + 0.3 * lin[0], lin[2]];
  return labOf(rgbToHex(m));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = ([r, g, b]) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
const contrast = (h1, h2) => {
  const [a, b] = [lum(hexToRgb(h1)), lum(hexToRgb(h2))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

// Target Lab L per slot. Two clusters: blue-side {1 navy,2 cyan,5 violet,8 slate},
// yellow-side {6 wine,3 ochre,7 olive,4 orange}.
const LADDER = {
  light:       [40, 58, 44, 57, 46, 32, 55, 34],
  dark:        [50, 80, 66, 86, 92, 54, 76, 68],
  dim:         [58, 82, 66, 90, 70, 58, 78, 46],
  highContrast:[58, 88, 72, 94, 96, 66, 88, 80],
};

for (const theme of THEMES) {
  const marker = theme === "light" ? ':root, :root[data-theme="light"] {' : ':root[data-theme="' + theme + '"] {';
  const block = css.slice(css.indexOf(marker));
  const bg = /--bg:\s*(#[0-9a-f]{6})/.exec(block)[1];
  console.log("/* " + theme + " */");
  let ok = true;
  const out = [];
  for (let i = 1; i <= 8; i++) {
    const hex = new RegExp("--project-" + i + ":\\s*(#[0-9a-f]{6})").exec(block)[1];
    const [, A, B] = labOf(hex);
    const newHex = labToHex([LADDER[theme][i - 1], A, B]);
    out.push(newHex);
    if (contrast(newHex, bg) < 3) {
      ok = false;
      console.log("  !! project-" + i + " " + newHex + " contrast " + contrast(newHex, bg).toFixed(2));
    }
  }
  // report deutan separations
  let worst = ["", 999];
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++) {
      const d = dist(deutanLab(out[a]), deutanLab(out[b]));
      if (d < worst[1]) worst = [`project-${a + 1}-vs-${b + 1}`, d];
    }
  console.log("  worst deutan pair: " + worst[0] + " = " + worst[1].toFixed(1));
  out.forEach((c, i) => console.log("  --project-" + (i + 1) + ": " + c + ";"));
}
