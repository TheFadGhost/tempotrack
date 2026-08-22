import { describe, expect, it } from "vitest";
import {
  ValidationError,
  addManualEntry,
  createProject,
  createTag,
  createTask,
  deleteEntry,
  editEntry,
  splitEntry,
  validateManualEntry,
} from "../../src/data/model.js";
import { emptyDatabase, type Database } from "../../src/data/schema.js";
import { findGaps, findOverlaps } from "../../src/data/overlap.js";
import { IdleMonitor } from "../../src/data/idle.js";
import { ManualClock } from "../helpers/clock.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function db(): Database {
  const d = emptyDatabase(NOW);
  createProject(d, "Aster Labs", { billableByDefault: true }, NOW);
  return d;
}

describe("manual entry validation", () => {
  it("rejects zero and negative durations", () => {
    const d = db();
    expect(() => addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: NOW - MIN, durationMs: 0 }, NOW)).toThrow(ValidationError);
    expect(() => addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: NOW - MIN, durationMs: -5 }, NOW)).toThrow(ValidationError);
  });

  it("rejects entries ending in the future", () => {
    const d = db();
    expect(() =>
      validateManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: NOW + 10 * MIN, durationMs: 60 * MIN }, NOW),
    ).toThrow(/future/);
  });

  it("rejects unknown projects and mismatched tasks", () => {
    const d = db();
    createTask(d, d.projects[0]!.id, "Draft spec", NOW);
    expect(() => addManualEntry(d, { projectId: "nope", taskId: null, tagIds: [], billable: false, startedWall: NOW - MIN, durationMs: MIN }, NOW)).toThrow(ValidationError);
    expect(() => addManualEntry(d, { projectId: d.projects[0]!.id, taskId: "wrong-project-task", tagIds: [], billable: false, startedWall: NOW - MIN, durationMs: MIN }, NOW)).toThrow(/task/i);
  });

  it("accepts a valid past entry", () => {
    const d = db();
    const e = addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: true, startedWall: NOW - 90 * MIN, durationMs: 90 * MIN }, NOW);
    expect(e.source).toBe("manual");
    expect(d.entries).toHaveLength(1);
  });
});

describe("audit trail", () => {
  it("editing an entry records what changed and marks it edited", () => {
    const d = db();
    const e = addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: NOW - 31 * MIN, durationMs: 30 * MIN }, NOW);
    editEntry(d, e.id, { billable: true, note: "kickoff call" }, NOW + 5_000, "user");
    expect(e.editedAt).toBe(NOW + 5_000);
    expect(e.revisions).toHaveLength(1);
    expect(e.revisions[0]!.fields).toEqual({ billable: [false, true], note: ["", "kickoff call"] });
  });

  it("splitting an entry preserves the total across both halves with audit on the first", () => {
    const d = db();
    const e = addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: NOW - 60 * MIN, durationMs: 60 * MIN }, NOW);
    const [a, b] = splitEntry(d, e.id, NOW - 25 * MIN, NOW);
    expect(a.durationMs).toBe(35 * MIN);
    expect(b.durationMs).toBe(25 * MIN);
    expect(b.startedWall).toBe(NOW - 25 * MIN);
    expect(a.revisions.some((r) => "durationMs" in r.fields)).toBe(true);
    expect(a.durationMs + b.durationMs).toBe(60 * MIN);
  });

  it("deletion is logged, not silent", () => {
    const d = db();
    const e = addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: NOW - MIN, durationMs: MIN }, NOW);
    deleteEntry(d, e.id, NOW + 1);
    expect(d.entries).toHaveLength(0);
    expect(d.auditLog[0]!.type).toBe("entryDeleted");
  });

  it("project creation rejects duplicates and unknown parents", () => {
    const d = db();
    expect(() => createProject(d, "aster labs", {}, NOW)).toThrow(/exists/);
    expect(() => createProject(d, "Child", { parentId: "ghost" }, NOW)).toThrow(ValidationError);
    const parent = createProject(d, "Parent", {}, NOW);
    expect(createProject(d, "Child", { parentId: parent.id }, NOW).parentId).toBe(parent.id);
    expect(createTag(d, "deep work").name).toBe("deep work");
    expect(createTag(d, "Deep Work").id).toBe(d.tags[0]!.id);
  });
});

describe("overlap detection", () => {
  function entry(id: string, startMin: number, durMin: number): import("../../src/data/schema.js").Entry {
    return {
      id, projectId: "p", taskId: null, tagIds: [], billable: false,
      startedWall: NOW + startMin * MIN, durationMs: durMin * MIN, note: "", source: "manual",
      acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null,
    };
  }

  it("touching entries are not overlaps", () => {
    expect(findOverlaps([entry("a", 0, 30), entry("b", 30, 30)])).toHaveLength(0);
  });

  it("detects partial, contained and identical overlaps with exact spans", () => {
    const pairs = findOverlaps([
      entry("a", 0, 60),
      entry("b", 30, 60), // partial with a
      entry("c", 10, 20), // contained in a
      entry("d", 120, 15),
      entry("e", 120, 15), // identical with d
      entry("f", 200, 10), // disjoint
    ]);
    const ids = pairs.map((p) => [p.aId, p.bId].sort().join("+")).sort();
    expect(ids).toEqual(["a+b", "a+c", "d+e"]);
    const ab = pairs.find((p) => (p.aId === "a" && p.bId === "b") || (p.aId === "b" && p.bId === "a"))!;
    expect(ab.overlapMs).toBe(30 * MIN);
    expect(ab.kind).toBe("partial");
    const ac = pairs.find((p) => (p.aId === "a" && p.bId === "c") || (p.aId === "c" && p.bId === "a"))!;
    expect(ac.kind).toBe("contained");
    const de = pairs.find((p) => (p.aId === "d" && p.bId === "e") || (p.aId === "e" && p.bId === "d"))!;
    expect(de.kind).toBe("identical");
  });
});

describe("gap detection", () => {
  it("reports unaccounted stretches inside working hours only", () => {
    const d = db();
    const dayStart = NOW - 48 * 60 * MIN;
    // Workday 09:00-12:00. Entries cover 09:00-09:30 and 11:00-11:30.
    addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: dayStart + 9 * 60 * MIN, durationMs: 30 * MIN }, NOW);
    addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: dayStart + 11 * 60 * MIN, durationMs: 30 * MIN }, NOW);
    const gaps = findGaps(d, { dayStartWall: dayStart, dayEndWall: dayStart + 24 * 60 * MIN }, { startMinute: 9 * 60, endMinute: 12 * 60 }, 5 * MIN);
    const bounds = gaps.map((g) => [(g.startWall - dayStart) / MIN, (g.endWall - dayStart) / MIN]);
    expect(bounds).toEqual([
      [9.5 * 60, 11 * 60],
      [11.5 * 60, 12 * 60],
    ]);
  });

  it("ignores gaps shorter than the minimum and dismissed ones", () => {
    const d = db();
    const dayStart = NOW - 48 * 60 * MIN;
    addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: dayStart + 9 * 60 * MIN, durationMs: 30 * MIN }, NOW);
    addManualEntry(d, { projectId: d.projects[0]!.id, taskId: null, tagIds: [], billable: false, startedWall: dayStart + 9 * 60 * MIN + 33 * MIN, durationMs: 27 * MIN }, NOW);
    let gaps = findGaps(d, { dayStartWall: dayStart, dayEndWall: dayStart + 24 * 60 * MIN }, { startMinute: 9 * 60, endMinute: 10 * 60 }, 5 * MIN);
    expect(gaps).toHaveLength(0); // 3-minute gap < 5-minute minimum
    gaps = findGaps(d, { dayStartWall: dayStart, dayEndWall: dayStart + 24 * 60 * MIN }, { startMinute: 9 * 60, endMinute: 10 * 60 }, 2 * MIN);
    expect(gaps).toHaveLength(1);
    d.gapDismissals.push({ dayKey: String(dayStart), startWall: gaps[0]!.startWall, endWall: gaps[0]!.endWall });
    expect(findGaps(d, { dayStartWall: dayStart, dayEndWall: dayStart + 24 * 60 * MIN }, { startMinute: 9 * 60, endMinute: 10 * 60 }, 2 * MIN)).toHaveLength(0);
  });
});

describe("idle detection", () => {
  it("fires once per idle stretch above threshold while the timer runs", () => {
    const clock = new ManualClock();
    const seen: number[] = [];
    const monitor = new IdleMonitor(clock, 5 * MIN, { onIdleDetected: (p) => seen.push(p.idleMs) });
    monitor.start();
    clock.advance(4 * MIN);
    expect(monitor.check(true)).toBeNull();
    clock.advance(2 * MIN);
    const payload = monitor.check(true)!;
    expect(payload.idleMs).toBe(6 * MIN);
    expect(seen).toEqual([6 * MIN]);
    clock.advance(10 * MIN);
    expect(monitor.check(true)).toBeNull(); // already prompted
  });

  it("activity resets the window and clears the prompt latch", () => {
    const clock = new ManualClock();
    let fired = 0;
    const monitor = new IdleMonitor(clock, 5 * MIN, { onIdleDetected: () => fired++ });
    monitor.start();
    clock.advance(6 * MIN);
    monitor.check(true);
    expect(fired).toBe(1);
    monitor.noteActivity("pointer");
    clock.advance(6 * MIN);
    monitor.check(true);
    expect(fired).toBe(2);
  });

  it("stays quiet when no timer is running", () => {
    const clock = new ManualClock();
    let fired = 0;
    const monitor = new IdleMonitor(clock, 5 * MIN, { onIdleDetected: () => fired++ });
    monitor.start();
    clock.advance(60 * MIN);
    expect(monitor.check(false)).toBeNull();
    expect(fired).toBe(0);
  });
});
