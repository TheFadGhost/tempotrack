import type { Database, Entry } from "./schema.js";

export interface EntrySpan {
  id: string;
  startWall: number;
  endWall: number;
}

export function spanOf(entry: Entry): EntrySpan {
  return { id: entry.id, startWall: entry.startedWall, endWall: entry.startedWall + entry.durationMs };
}

export interface OverlapPair {
  aId: string;
  bId: string;
  /** Overlapped milliseconds shared by both entries. */
  overlapMs: number;
  kind: "contained" | "partial" | "identical";
}

/** Touching entries (a.end == b.start) are NOT overlaps. */
export function findOverlaps(entries: Entry[]): OverlapPair[] {
  const sorted = [...entries].sort((x, y) => x.startedWall - y.startedWall || x.durationMs - y.durationMs);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = spanOf(sorted[i]!);
      const b = spanOf(sorted[j]!);
      if (b.startWall >= a.endWall) break;
      if (a.startWall >= b.endWall) continue;
      const overlapMs = Math.min(a.endWall, b.endWall) - Math.max(a.startWall, b.startWall);
      let kind: OverlapPair["kind"] = "partial";
      if (overlapMs === 0) continue;
      if (a.startWall === b.startWall && a.endWall === b.endWall) kind = "identical";
      else if (a.startWall <= b.startWall && a.endWall >= b.endWall) kind = "contained";
      else if (b.startWall <= a.startWall && b.endWall >= a.endWall) kind = "contained";
      pairs.push({ aId: a.id, bId: b.id, overlapMs, kind });
    }
  }
  return pairs;
}

export interface WorkWindow {
  /** Minutes from local midnight. */
  startMinute: number;
  endMinute: number;
}

export interface DayRange {
  /** Wall ms of local midnight for the day. */
  dayStartWall: number;
  /** Wall ms of the next local midnight. */
  dayEndWall: number;
}

export interface Gap {
  startWall: number;
  endWall: number;
  durationMs: number;
}

/**
 * Unaccounted intervals strictly inside the working window of a day, longer
 * than minGapMs and not previously dismissed by the user.
 */
export function findGaps(
  db: Database,
  range: DayRange,
  window: WorkWindow,
  minGapMs: number,
): Gap[] {
  const windowStart = range.dayStartWall + window.startMinute * 60_000;
  const windowEnd = range.dayStartWall + window.endMinute * 60_000;
  if (windowEnd <= windowStart) return [];

  const dismissed = new Set(
    db.gapDismissals.filter((g) => g.dayKey === String(range.dayStartWall)).map((g) => `${g.startWall}:${g.endWall}`),
  );

  const spans = db.entries
    .filter((e) => e.startedWall < windowEnd && e.startedWall + e.durationMs > windowStart)
    .map(spanOf)
    .sort((a, b) => a.startWall - b.startWall);

  const gaps: Gap[] = [];
  let cursor = windowStart;
  for (const span of spans) {
    const s = Math.max(span.startWall, windowStart);
    const e = Math.min(span.endWall, windowEnd);
    if (s > cursor) {
      pushGap(gaps, cursor, s, minGapMs, dismissed);
    }
    cursor = Math.max(cursor, e);
  }
  if (windowEnd > cursor) {
    pushGap(gaps, cursor, windowEnd, minGapMs, dismissed);
  }
  return gaps;
}

function pushGap(gaps: Gap[], startWall: number, endWall: number, minGapMs: number, dismissed: Set<string>): void {
  const durationMs = endWall - startWall;
  if (durationMs < minGapMs) return;
  if (dismissed.has(`${startWall}:${endWall}`)) return;
  gaps.push({ startWall, endWall, durationMs });
}
