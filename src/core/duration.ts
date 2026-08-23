const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Display duration, h:mm. 90 minutes -> "1:30". Negative input is a bug and
 * throws; durations are never displayed as negative.
 */
export function formatHM(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`duration must be >= 0, got ${ms}`);
  const totalMinutes = Math.round(ms / MS_PER_MINUTE);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Live-timer duration: m:ss under an hour, h:mm:ss at or past one hour. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`duration must be >= 0, got ${ms}`);
  const totalSeconds = Math.floor(ms / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Decimal hours for billing contexts only, exactly two places.
 * Implemented in integer hundredths of an hour so no float is ever formatted.
 */
export function formatDecimalHours(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`duration must be >= 0, got ${ms}`);
  const centiHours = roundDiv(ms, MS_PER_HOUR / 100);
  return `${Math.floor(centiHours / 100)}.${String(centiHours % 100).padStart(2, "0")}`;
}

/** Parses "h:mm" or "h.mm" into milliseconds. Throws on malformed input. */
export function parseHM(input: string): number {
  const match = /^(\d+)[.:,](\d{1,2})$/.exec(input.trim());
  if (!match) {
    const plain = /^\d+$/.exec(input.trim());
    if (plain) return Number(input) * MS_PER_HOUR;
    throw new Error(`Use h:mm (hours:minutes), for example 1:30 — got "${input}"`);
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m >= 60) throw new Error(`Minutes must be below 60 — got "${input}"`);
  return h * MS_PER_HOUR + m * MS_PER_MINUTE;
}

/** Integer division with half-up rounding for non-negative integers. */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error("roundDiv requires safe integers");
  }
  if (denominator <= 0) throw new Error("denominator must be positive");
  if (numerator < 0) throw new Error("numerator must be non-negative");
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return 2 * r >= denominator ? q + 1 : q;
}
