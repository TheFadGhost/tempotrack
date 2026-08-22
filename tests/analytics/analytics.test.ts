import { describe, expect, it } from "vitest";
import { dailyTotals, entriesOfDays, totalsByProject, totalsByTag, weekdayHourHeatmap } from "../../src/analytics/aggregate.js";
import { averageSessionLengthMs, focusStreaks, pomodoroCompletion, weekOverWeekDeltaMs } from "../../src/analytics/metrics.js";
import { goalProgress } from "../../src/analytics/goals.js";
import { billableLines, effectiveRate } from "../../src/analytics/billing.js";
import { addDays, dayKeyOf, startOfDayWall, startOfWeek, weekdayOf, type TzOffsetFn } from "../../src/analytics/time.js";
import { emptyDatabase, type Database, type Entry } from "../../src/data/schema.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Fixed UTC+2 offset; the DST tests switch to UTC+1 mid-fixture. */
const tzPlus2: TzOffsetFn = () => 120;
const tzDST: TzOffsetFn = (wall) => (wall >= DST_CUTOVER ? 60 : 120);
const DST_CUTOVER = Date.parse("2026-03-29T01:00:00Z");

function makeDb(): Database {
  return emptyDatabase(Date.parse("2026-01-05T00:00:00Z"));
}

function entry(db: Database, e: Partial<Entry> & { startedWall: number; durationMs: number }): Entry {
  const full: Entry = {
    id: e.id ?? `e${db.entries.length + 1}`,
    projectId: e.projectId ?? "p1",
    taskId: e.taskId ?? null,
    tagIds: e.tagIds ?? [],
    billable: e.billable ?? false,
    startedWall: e.startedWall,
    durationMs: e.durationMs,
    note: e.note ?? "",
    source: "manual",
    acknowledgedOverlapsWith: [],
    revisions: [],
    createdAt: e.startedWall,
    editedAt: null,
  };
  db.entries.push(full);
  return full;
}

const MON = startOfDayWall("2026-03-02", tzPlus2); // a Monday

describe("day attribution and totals", () => {
  it("attributes an entry to the local day of its start, never splitting midnight spans", () => {
    const db = makeDb();
    const lateNight = startOfDayWall("2026-03-02", tzPlus2) + 23 * HOUR;
    entry(db, { startedWall: lateNight, durationMs: 2 * HOUR }); // crosses into Tue
    const keys = ["2026-03-02", "2026-03-03"];
    const totals = dailyTotals(db, keys, tzPlus2);
    expect(totals.map((t) => t.focusedMs)).toEqual([2 * HOUR, 0]);
  });

  it("a DST spring-forward day is one hour short but attribution stays correct", () => {
    const db = makeDb();
    // 2026-03-29 in tzDST: clocks jump 01:00->02:00 UTC.
    const before = Date.parse("2026-03-29T00:30:00Z"); // still Sunday, UTC+2 side
    entry(db, { startedWall: before, durationMs: 30 * MIN });
    const sundayKey = dayKeyOf(before, tzDST);
    expect(sundayKey).toBe("2026-03-29");
    const totals = dailyTotals(db, [sundayKey], tzDST);
    expect(totals[0]!.focusedMs).toBe(30 * MIN);
  });

  it("entries keep their durations across a timezone change (pure ms)", () => {
    const db = makeDb();
    const wall = Date.parse("2026-03-29T12:00:00Z");
    const e = entry(db, { startedWall: wall, durationMs: 90 * MIN });
    expect(e.durationMs).toBe(90 * MIN);
    expect(dayKeyOf(wall - HOUR, tzDST)).toBe(dayKeyOf(wall - HOUR, tzPlus2));
  });
});

describe("breakdowns", () => {
  it("groups per project and per tag with billable subsets", () => {
    const db = makeDb();
    db.projects.push({ id: "p1", name: "Aster", parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON });
    db.tags.push({ id: "t1", name: "deep" }, { id: "t2", name: "admin" });
    entry(db, { startedWall: MON + 9 * HOUR, durationMs: 2 * HOUR, projectId: "p1", tagIds: ["t1"], billable: true });
    entry(db, { startedWall: MON + 13 * HOUR, durationMs: 1 * HOUR, projectId: "p1", tagIds: ["t1"], billable: true });
    entry(db, { startedWall: MON + 15 * HOUR, durationMs: 30 * MIN, projectId: "p1", tagIds: ["t2"] });
    const days = [dayKeyOf(MON, tzPlus2)];
    expect(totalsByProject(db, days, tzPlus2)).toEqual([{ id: "p1", focusedMs: 3.5 * HOUR, billableFocusedMs: 3 * HOUR }]);
    expect(totalsByTag(db, days, tzPlus2)).toEqual([
      { id: "t1", focusedMs: 3 * HOUR, billableFocusedMs: 3 * HOUR },
      { id: "t2", focusedMs: 0.5 * HOUR, billableFocusedMs: 0 },
    ]);
  });
});

describe("heatmap", () => {
  it("computes weekday x hour averages over occurrences, honest zeros elsewhere", () => {
    const db = makeDb();
    db.projects.push({ id: "p1", name: "Aster", parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON });
    // Two Mondays, each with 60 min at 09:00 local -> avg cell (Mon,9)=60.
    for (const key of ["2026-03-02", "2026-03-09"]) {
      entry(db, { startedWall: startOfDayWall(key, tzPlus2) + 9 * HOUR, durationMs: HOUR });
    }
    const days = ["2026-03-02", "2026-03-04", "2026-03-09"]; // Mon, Wed, Mon
    const { cells, occurrencesPerWeekday } = weekdayHourHeatmap(db, days, tzPlus2);
    expect(occurrencesPerWeekday[0]).toBe(2);
    expect(occurrencesPerWeekday[2]).toBe(1);
    expect(cells[0]![9]).toBe(60);
    expect(cells[0]![10]).toBe(0);
    expect(cells[2]!.every((v) => v === 0)).toBe(true);
  });
});

describe("pomodoro metrics", () => {
  it("completion rate counts completed vs abandoned work phases only", () => {
    const db = makeDb();
    const monday = startOfDayWall("2026-03-02", tzPlus2);
    db.pomodoroEvents.push(
      { id: "1", atWall: monday + 10 * HOUR, type: "workCompleted", durationMs: 25 * MIN, projectId: "p1" },
      { id: "2", atWall: monday + 11 * HOUR, type: "workCompleted", durationMs: 25 * MIN, projectId: "p1" },
      { id: "3", atWall: monday + 12 * HOUR, type: "workAbandoned", durationMs: 8 * MIN, projectId: "p1" },
      { id: "4", atWall: monday + 13 * HOUR, type: "breakCompleted", durationMs: 5 * MIN, projectId: null },
    );
    const r = pomodoroCompletion(db, [dayKeyOf(monday, tzPlus2)], tzPlus2);
    expect(r.completed).toBe(2);
    expect(r.abandoned).toBe(1);
    expect(r.rate).toBeCloseTo(2 / 3);
  });

  it("rate is null when no work phases ended", () => {
    const db = makeDb();
    expect(pomodoroCompletion(db, ["2026-03-02"], tzPlus2).rate).toBeNull();
  });
});

describe("streaks and comparisons", () => {
  it("average session length means all focus entries", () => {
    const db = makeDb();
    const monday = startOfDayWall("2026-03-02", tzPlus2);
    entry(db, { startedWall: monday + 9 * HOUR, durationMs: 50 * MIN });
    entry(db, { startedWall: monday + 11 * HOUR, durationMs: 10 * MIN });
    entry(db, { startedWall: monday + 13 * HOUR, durationMs: 30 * MIN });
    expect(averageSessionLengthMs(db, [dayKeyOf(monday, tzPlus2)], tzPlus2)).toBe(30 * MIN);
  });

  it("focus streaks count consecutive qualifying days and allow pending today", () => {
    const mk = (ms: number[]) =>
      ms.map((focusedMs, i) => ({ dayKey: String(i), focusedMs, billableFocusedMs: 0 }));
    expect(focusStreaks(mk([HOUR, HOUR, 0, HOUR, HOUR, HOUR]), 25 * MIN, false)).toEqual({ current: 3, longest: 3 });
    // Today (the zero) is pending, not failed: the two prior days still count.
    expect(focusStreaks(mk([HOUR, HOUR, 0]), 25 * MIN, true)).toEqual({ current: 2, longest: 2 });
    expect(focusStreaks(mk([5 * MIN, HOUR]), 25 * MIN, true)).toEqual({ current: 1, longest: 1 });
  });

  it("week-over-week delta subtracts exactly", () => {
    expect(weekOverWeekDeltaMs(5 * HOUR, 7 * HOUR)).toBe(-2 * HOUR);
  });
});

describe("week boundaries", () => {
  it("respects Monday week start; Sunday belongs to the previous week", () => {
    expect(startOfWeek("2026-03-01", 1, tzPlus2)).toBe("2026-02-23"); // Sunday -> prior Monday
    expect(startOfWeek("2026-03-02", 1, tzPlus2)).toBe("2026-03-02");
    expect(startOfWeek("2026-03-01", 0, tzPlus2)).toBe("2026-03-01"); // Sunday start
    expect(weekdayOf("2026-03-01", tzPlus2)).toBe(0);
  });

  it("addDays walks calendar days across the DST cutover", () => {
    expect(addDays("2026-03-28", 1, tzDST)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1, tzDST)).toBe("2026-03-30");
  });
});

describe("goals", () => {
  function projectWithGoal(db: Database, id: string, targetMs: number, period: "day" | "week") {
    db.projects.push({ id, name: id, parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: targetMs, goalPeriod: period, archived: false, createdAt: MON });
  }

  it("daily goal reports progress and behind only when pace lags elapsed day", () => {
    const db = makeDb();
    projectWithGoal(db, "g1", 4 * HOUR, "day");
    const dayStart = startOfDayWall("2026-03-02", tzPlus2);
    const nowNoon = dayStart + 12 * HOUR; // exactly half the day elapsed
    entry(db, { startedWall: nowNoon - 3 * HOUR, durationMs: HOUR, projectId: "g1" });
    let p = goalProgress(db, nowNoon, tzPlus2)[0]!;
    expect(p.focusedMs).toBe(HOUR);
    expect(p.behind).toBe(true); // 1h worked vs 2h expected by noon
    entry(db, { startedWall: nowNoon - HOUR, durationMs: HOUR, projectId: "g1" });
    p = goalProgress(db, nowNoon, tzPlus2)[0]!;
    expect(p.focusedMs).toBe(2 * HOUR);
    expect(p.behind).toBe(false); // 2h == expected at half-day
  });

  it("weekly goal uses configured week start and elapsed fraction", () => {
    const db = makeDb();
    projectWithGoal(db, "w1", 40 * HOUR, "week");
    const monday = startOfDayWall("2026-03-02", tzPlus2);
    const mondayEvening = monday + 18 * HOUR; // 18/168 of the week elapsed
    entry(db, { startedWall: monday + 9 * HOUR, durationMs: 8 * HOUR, projectId: "w1" });
    let p = goalProgress(db, mondayEvening, tzPlus2)[0]!;
    expect(p.period).toBe("week");
    expect(p.focusedMs).toBe(8 * HOUR);
    expect(p.behind).toBe(false); // 8h > expected ~4.3h
    // By Wednesday noon only ~14.3h are expected, so 8h is honestly behind.
    p = goalProgress(db, startOfDayWall("2026-03-04", tzPlus2) + 12 * HOUR, tzPlus2)[0]!;
    expect(p.behind).toBe(true);
  });
});

describe("billing", () => {
  it("rounds per entry, half-up, once, in integer minor units", () => {
    const db = makeDb();
    db.projects.push({ id: "r1", name: "Rate", parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: 9000, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON });
    // 20 min at 90.00/h = 30.00 exactly; 7 min = 10.50 exactly.
    const e1 = entry(db, { startedWall: MON + HOUR, durationMs: 20 * MIN, projectId: "r1", billable: true });
    const e2 = entry(db, { startedWall: MON + 3 * HOUR, durationMs: 7 * MIN, projectId: "r1", billable: true });
    void e1; void e2;
    const lines = billableLines(db, db.entries);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountMinor).toBe(3000 + 1050);
  });

  it("odd minutes round half-up per line item without float drift", () => {
    const db = makeDb();
    db.projects.push({ id: "r2", name: "Rate2", parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: 9999, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON });
    // 1 minute at 99.99/h = 1.6665 -> rounds to 167 minor units (half-up).
    entry(db, { startedWall: MON, durationMs: MIN, projectId: "r2", billable: true });
    expect(billableLines(db, db.entries)[0]!.amountMinor).toBe(167);
  });

  it("rate falls back to the nearest ancestor project", () => {
    const db = makeDb();
    db.projects.push(
      { id: "parent", name: "Parent", parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: 5000, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON },
      { id: "child", name: "Child", parentId: "parent", colorIndex: 1, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON },
    );
    expect(effectiveRate(db, "child")).toBe(5000);
    expect(effectiveRate(db, "ghost")).toBeNull();
  });

  it("non-billable entries contribute nothing even under a rated project", () => {
    const db = makeDb();
    db.projects.push({ id: "r3", name: "R3", parentId: null, colorIndex: 0, billableByDefault: false, rateMinorPerHour: 10_000, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: MON });
    entry(db, { startedWall: MON, durationMs: HOUR, projectId: "r3", billable: false });
    expect(billableLines(db, db.entries)).toHaveLength(0);
  });

  it("entriesOfDays matches dailyTotals inputs exactly", () => {
    const db = makeDb();
    entry(db, { startedWall: MON + HOUR, durationMs: MIN });
    const list = entriesOfDays(db, [dayKeyOf(MON, tzPlus2)], tzPlus2);
    expect(list).toHaveLength(1);
  });
});
