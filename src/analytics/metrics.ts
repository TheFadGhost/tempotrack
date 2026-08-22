import type { Database } from "../data/schema.js";
import { dayKeyOf } from "./time.js";
import { entriesOfDays, type DayTotals } from "./aggregate.js";
import type { TzOffsetFn } from "./time.js";

export function pomodoroCompletion(db: Database, dayKeys: string[], tz: TzOffsetFn): {
  completed: number;
  abandoned: number;
  /** completed / (completed + abandoned); null when no work phases ended. */
  rate: number | null;
} {
  const keys = new Set(dayKeys);
  const relevant = db.pomodoroEvents.filter((e) => (e.type === "workCompleted" || e.type === "workAbandoned") && keys.has(dayKeyOf(e.atWall, tz)));
  let completed = 0;
  let abandoned = 0;
  for (const e of relevant) {
    if (e.type === "workCompleted") completed += 1;
    else abandoned += 1;
  }
  return { completed, abandoned, rate: completed + abandoned === 0 ? null : completed / (completed + abandoned) };
}

export function averageSessionLengthMs(db: Database, dayKeys: string[], tz: TzOffsetFn): number | null {
  const list = entriesOfDays(db, dayKeys, tz);
  if (list.length === 0) return null;
  const total = list.reduce((sum, e) => sum + e.durationMs, 0);
  return Math.round(total / list.length);
}

export interface FocusStreaks {
  current: number;
  longest: number;
}

/**
 * A day counts toward a streak when focusedMs >= minFocusedMs. `current`
 * counts back from the last day in the provided sequence (typically today);
 * it stops at the first miss, but a not-yet-finished today (below threshold)
 * is allowed to be pending without breaking the streak that precedes it.
 */
export function focusStreaks(
  totalsAscending: DayTotals[],
  minFocusedMs: number,
  todayIsLastDay: boolean,
): FocusStreaks {
  let longest = 0;
  let run = 0;
  for (const t of totalsAscending) {
    if (t.focusedMs >= minFocusedMs) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let i = totalsAscending.length - 1; i >= 0; i--) {
    const t = totalsAscending[i]!;
    if (t.focusedMs >= minFocusedMs) {
      current += 1;
    } else if (todayIsLastDay && i === totalsAscending.length - 1) {
      continue;
    } else {
      break;
    }
  }
  return { current, longest };
}

export function weekOverWeekDeltaMs(thisWeekMs: number, previousWeekMs: number): number {
  return thisWeekMs - previousWeekMs;
}
