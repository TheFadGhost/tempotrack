import type { Database, Entry } from "../data/schema.js";
import { formatDecimalHours } from "../core/duration.js";
import { dayKeyOf, systemTzOffset, type TzOffsetFn } from "../analytics/time.js";

/** RFC 4180: quote fields containing separators, quotes or newlines. */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((r) => r.map((c) => csvEscape(c)).join(","));
  return lines.join("\r\n") + "\r\n";
}

function localStamp(wallMs: number, tz: TzOffsetFn): { dayKey: string; time: string } {
  const shifted = new Date(wallMs + tz(wallMs) * 60_000);
  return { dayKey: shifted.toISOString().slice(0, 10), time: shifted.toISOString().slice(11, 16) };
}

export function projectPath(db: Database, projectId: string): string {
  const parts: string[] = [];
  let current = db.projects.find((p) => p.id === projectId) ?? null;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current.id)) {
    guard.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? db.projects.find((p) => p.id === current!.parentId) ?? null : null;
  }
  return parts.join(" / ");
}

export const ENTRIES_CSV_HEADER = [
  "entry_id",
  "date",
  "start_local",
  "start_utc",
  "project",
  "task",
  "tags",
  "duration_ms",
  "hours_decimal",
  "billable",
  "note",
] as const;

export function entriesToCsv(db: Database, entries: Entry[], tz: TzOffsetFn = systemTzOffset): string {
  const sorted = [...entries].sort((a, b) => a.startedWall - b.startedWall);
  const rows = sorted.map((e) => {
    const stamp = localStamp(e.startedWall, tz);
    const taskName = e.taskId ? db.tasks.find((t) => t.id === e.taskId)?.name ?? "" : "";
    const tagNames = e.tagIds.map((id) => db.tags.find((t) => t.id === id)?.name ?? "").filter(Boolean).join("|");
    return [
      e.id,
      stamp.dayKey,
      `${stamp.dayKey} ${stamp.time}`,
      new Date(e.startedWall).toISOString(),
      projectPath(db, e.projectId),
      taskName,
      tagNames,
      String(e.durationMs),
      formatDecimalHours(e.durationMs),
      e.billable ? "yes" : "no",
      e.note,
    ];
  });
  return toCsv([...ENTRIES_CSV_HEADER], rows);
}

/** Machine-checkable invariant: every exported row's duration appears in source data. */
export function assertTotalsMatch(entries: Entry[], rowsHoursDecimal: string[]): void {
  const msSum = entries.reduce((s, e) => s + e.durationMs, 0);
  const centiHourSum = rowsHoursDecimal.reduce((s, h) => s + Math.round(Number(h) * 100), 0);
  if (Math.round(msSum / 36_000) !== centiHourSum) {
    throw new Error("Export totals diverge from entry data");
  }
}

export function dayKeysCovered(entries: Entry[], tz: TzOffsetFn = systemTzOffset): string[] {
  const keys = new Set(entries.map((e) => dayKeyOf(e.startedWall, tz)));
  return [...keys].sort();
}
