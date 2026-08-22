/**
 * Day attribution. The canonical convention, used everywhere:
 *
 *  - An entry belongs to exactly one local calendar day: the day containing
 *    its placement start (startedWall). Durations are never split across
 *    midnight.
 *  - Local day boundaries come from an injectable timezone-offset function so
 *    DST transitions and travel are deterministic and testable. Offsets are
 *    expressed as minutes to ADD to UTC to get local time (positive east),
 *    which is the negation of JavaScript's getTimezoneOffset().
 */
export type TzOffsetFn = (wallMs: number) => number;

export const systemTzOffset: TzOffsetFn = (wallMs) => -new Date(wallMs).getTimezoneOffset();

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** "YYYY-MM-DD" of the local day containing wallMs. */
export function dayKeyOf(wallMs: number, tz: TzOffsetFn): string {
  const local = new Date(wallMs + tz(wallMs) * MS_PER_MINUTE);
  return local.toISOString().slice(0, 10);
}

/** Wall ms at local midnight starting the given day key. */
export function startOfDayWall(dayKey: string, tzAt: (localGuessWall: number) => number): number {
  const utcGuess = Date.parse(`${dayKey}T00:00:00.000Z`);
  let guess = utcGuess - tzAt(utcGuess) * MS_PER_MINUTE;
  // One refinement step handles offsets that differ around midnight (DST).
  guess = utcGuess - tzAt(guess) * MS_PER_MINUTE;
  return guess;
}

/** Adds n local days to a day key (calendar-correct across DST). */
export function addDays(dayKey: string, n: number, tz: TzOffsetFn): string {
  const noonWall = startOfDayWall(dayKey, tz) + 12 * 3_600_000;
  return dayKeyOf(noonWall + n * MS_PER_DAY, tz);
}

/** Weekday index of a day key, 0=Sunday..6=Saturday, in local time. */
export function weekdayOf(dayKey: string, tz: TzOffsetFn): number {
  const noonWall = startOfDayWall(dayKey, tz) + 12 * 3_600_000;
  return new Date(noonWall + tz(noonWall) * MS_PER_MINUTE).getUTCDay();
}

/** Monday-or-Sunday-based first day of the week containing dayKey. */
export function startOfWeek(dayKey: string, weekStartsOn: 0 | 1, tz: TzOffsetFn): string {
  const wd = weekdayOf(dayKey, tz);
  const delta = weekStartsOn === 1 ? (wd === 0 ? 6 : wd - 1) : wd;
  return addDays(dayKey, -delta, tz);
}
