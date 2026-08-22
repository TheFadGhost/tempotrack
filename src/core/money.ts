import { roundDiv } from "./duration.js";

const MS_PER_HOUR = 3_600_000;

/**
 * Billable amount for a duration at an hourly rate, entirely in integer minor
 * units (e.g. cents). Rounding is half-up applied once, at the final amount,
 * never per entry component. Floats are never involved.
 */
export function billableMinorUnits(durationMs: number, minorPerHour: number): number {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new Error(`durationMs must be a safe non-negative integer, got ${durationMs}`);
  }
  if (!Number.isSafeInteger(minorPerHour) || minorPerHour < 0) {
    throw new Error(`minorPerHour must be a safe non-negative integer, got ${minorPerHour}`);
  }
  if (durationMs === 0 || minorPerHour === 0) return 0;
  return roundDiv(durationMs * minorPerHour, MS_PER_HOUR);
}

/** Formats integer minor units as a decimal major-unit string, e.g. 12345 -> "123.45". */
export function formatMinor(amountMinor: number, decimals = 2): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error(`amount must be an integer, got ${amountMinor}`);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const scale = 10 ** decimals;
  const whole = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(decimals, "0");
  return `${sign}${whole}.${frac}`;
}
