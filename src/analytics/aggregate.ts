import type { Database, Entry } from "../data/schema.js";
import { dayKeyOf, startOfDayWall, type TzOffsetFn } from "./time.js";

/**
 * Metric definitions (single source of truth — the README mirrors these):
 *
 *  focusedMs(day)        Sum of durationMs of entries whose placement START
 *                        falls on that local day. No splitting at midnight.
 *  billableMs            Subset of focusedMs from billable entries.
 *  perProject / perTag   Same sums, grouped by entry.projectId / each tagId.
 *  heatmap cell          Average focused minutes for one weekday x hour-of-day
 *                        across the range: total minutes in that bucket divided
 *                        by the number of days of that weekday present in the
 *                        range. Buckets use the LOCAL hour of placement start.
 *  completionRate        completedWorkPhases / (completed + abandoned), from
 *                        pomodoroEvents. null when denominator is zero.
 *  averageSessionLength  Arithmetic mean durationMs over focus entries in
 *                        range (manual and timed alike). null when empty.
 *  streak                Consecutive local days with focusedMs >= threshold.
 *  weekOverWeekDelta     This week's focusedMs minus previous week's, in ms.
 */
export interface DayTotals {
  dayKey: string;
  focusedMs: number;
  billableFocusedMs: number;
}

export function entriesInRange(db: Database, rangeStartWall: number, rangeEndWall: number): Entry[] {
  return db.entries.filter((e) => {
    const end = e.startedWall + e.durationMs;
    return e.startedWall < rangeEndWall && end > rangeStartWall;
  });
}

/** Entries attributed to a day by their placement start. */
export function entriesOfDays(db: Database, dayKeys: string[], tz: TzOffsetFn): Entry[] {
  const keys = new Set(dayKeys);
  return db.entries.filter((e) => keys.has(dayKeyOf(e.startedWall, tz)));
}

/**
 * Union of all entry intervals in wall-clock ms — the time actually covered by
 * at least one entry. Used to report honest net values next to gross totals
 * whenever entries overlap.
 */
export function coveredUnionMs(entries: Entry[]): number {
  if (entries.length === 0) return 0;
  const spans = entries
    .map((e) => ({ start: e.startedWall, end: e.startedWall + e.durationMs }))
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursorStart = spans[0]!.start;
  let cursorEnd = spans[0]!.end;
  for (let i = 1; i < spans.length; i++) {
    const s = spans[i]!;
    if (s.start > cursorEnd) {
      total += cursorEnd - cursorStart;
      cursorStart = s.start;
      cursorEnd = s.end;
    } else if (s.end > cursorEnd) {
      cursorEnd = s.end;
    }
  }
  total += cursorEnd - cursorStart;
  return total;
}

export function dailyTotals(db: Database, dayKeys: string[], tz: TzOffsetFn): DayTotals[] {
  const byDay = new Map<string, DayTotals>(dayKeys.map((k) => [k, { dayKey: k, focusedMs: 0, billableFocusedMs: 0 }]));
  for (const e of db.entries) {
    const key = dayKeyOf(e.startedWall, tz);
    const slot = byDay.get(key);
    if (!slot) continue;
    slot.focusedMs += e.durationMs;
    if (e.billable) slot.billableFocusedMs += e.durationMs;
  }
  return dayKeys.map((k) => byDay.get(k)!);
}

export interface GroupTotal {
  id: string;
  focusedMs: number;
  billableFocusedMs: number;
}

export function totalsByProject(db: Database, dayKeys: string[], tz: TzOffsetFn): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const e of entriesOfDays(db, dayKeys, tz)) {
    let g = map.get(e.projectId);
    if (!g) map.set(e.projectId, (g = { id: e.projectId, focusedMs: 0, billableFocusedMs: 0 }));
    g.focusedMs += e.durationMs;
    if (e.billable) g.billableFocusedMs += e.durationMs;
  }
  return [...map.values()].sort((a, b) => b.focusedMs - a.focusedMs);
}

export function totalsByTag(db: Database, dayKeys: string[], tz: TzOffsetFn): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const e of entriesOfDays(db, dayKeys, tz)) {
    for (const tagId of e.tagIds) {
      let g = map.get(tagId);
      if (!g) map.set(tagId, (g = { id: tagId, focusedMs: 0, billableFocusedMs: 0 }));
      g.focusedMs += e.durationMs;
      if (e.billable) g.billableFocusedMs += e.durationMs;
    }
  }
  return [...map.values()].sort((a, b) => b.focusedMs - a.focusedMs);
}

/** 7x24 grid; rows Monday..Sunday, columns hour 0..23, values avg minutes. */
export function weekdayHourHeatmap(
  db: Database,
  dayKeys: string[],
  tz: TzOffsetFn,
): { cells: number[][]; occurrencesPerWeekday: number[] } {
  const totals = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const occurrences = new Array<number>(7).fill(0);
  for (const key of dayKeys) {
    const midnight = startOfDayWall(key, tz);
    const wd = (new Date(midnight + tz(midnight) * 60_000).getUTCDay() + 6) % 7; // Monday=0
    occurrences[wd]! += 1;
  }
  for (const e of entriesOfDays(db, dayKeys, tz)) {
    const midnight = startOfDayWall(dayKeyOf(e.startedWall, tz), tz);
    const wd = (new Date(midnight + tz(midnight) * 60_000).getUTCDay() + 6) % 7;
    const localMs = e.startedWall + tz(e.startedWall) * 60_000;
    const hour = Math.floor((localMs % 86_400_000) / 3_600_000);
    totals[wd]![hour]! += e.durationMs / 60_000;
  }
  const cells = totals.map((row, wd) =>
    row.map((minutes) => (occurrences[wd]! === 0 ? 0 : minutes / occurrences[wd]!)),
  );
  return { cells, occurrencesPerWeekday: occurrences };
}
