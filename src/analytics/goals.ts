import type { Database } from "../data/schema.js";
import { dayKeyOf, startOfDayWall, startOfWeek, type TzOffsetFn } from "./time.js";
import { dailyTotals } from "./aggregate.js";

const MS_PER_DAY = 86_400_000;

export interface GoalProgress {
  projectId: string;
  period: "day" | "week";
  targetMs: number;
  focusedMs: number;
  /** focusedMs / targetMs, capped at 1 for display purposes upstream. */
  fraction: number;
  /**
   * True only when the evidence says behind:
   *  - elapsed period (past day / past week): focused < target.
   *  - current period: focused < target * elapsedFractionOfPeriod.
   * A future period is never behind. No other nudges exist by design.
   */
  behind: boolean;
}

/**
 * Progress for every project goal relative to `nowWall`.
 * Daily goals use today; weekly goals use the week containing today under the
 * configured week start. Elapsed fractions use full local days/weeks.
 */
export function goalProgress(db: Database, nowWall: number, tz: TzOffsetFn): GoalProgress[] {
  const out: GoalProgress[] = [];
  const today = dayKeyOf(nowWall, tz);
  const goals = db.projects.filter((p) => !p.archived && p.goalTargetMs !== null && p.goalTargetMs > 0 && p.goalPeriod !== null);
  if (goals.length === 0) return out;

  const totalsByDay = new Map(dailyTotals(db, [today], tz).map((t) => [t.dayKey, t]));
  const perProjectToday = new Map<string, number>();
  for (const e of db.entries) {
    if (dayKeyOf(e.startedWall, tz) !== today) continue;
    perProjectToday.set(e.projectId, (perProjectToday.get(e.projectId) ?? 0) + e.durationMs);
  }
  const weekStartKey = startOfWeek(today, db.settings.weekStartsOn, tz);
  const weekDayKeys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const key = dayKeyOf(startOfDayWall(weekStartKey, tz) + i * MS_PER_DAY + 12 * 3_600_000, tz);
    if (!weekDayKeys.includes(key)) weekDayKeys.push(key);
  }
  const perProjectWeek = new Map<string, number>();
  for (const e of db.entries) {
    if (!weekDayKeys.includes(dayKeyOf(e.startedWall, tz))) continue;
    perProjectWeek.set(e.projectId, (perProjectWeek.get(e.projectId) ?? 0) + e.durationMs);
  }

  const dayStartWall = startOfDayWall(today, tz);
  const dayFraction = clamp01((nowWall - dayStartWall) / MS_PER_DAY);

  for (const project of goals) {
    const target = project.goalTargetMs!;
    if (project.goalPeriod === "day") {
      const focused = perProjectToday.get(project.id) ?? 0;
      out.push({
        projectId: project.id,
        period: "day",
        targetMs: target,
        focusedMs: focused,
        fraction: focused / target,
        behind: focused < Math.floor(target * dayFraction),
      });
    } else {
      const focused = perProjectWeek.get(project.id) ?? 0;
      const weekStartWall = startOfDayWall(weekStartKey, tz);
      const fraction = clamp01((nowWall - weekStartWall) / (7 * MS_PER_DAY));
      out.push({
        projectId: project.id,
        period: "week",
        targetMs: target,
        focusedMs: focused,
        fraction: focused / target,
        behind: focused < Math.floor(target * fraction),
      });
    }
  }
  void totalsByDay;
  return out;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
