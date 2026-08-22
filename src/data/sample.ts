/**
 * Generates an obviously fictional sample database for demos.
 * All names are invented; nothing here is real client or project data.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let counter = 0;

export function buildSampleDatabase(nowWall: number): {
  schemaVersion: number;
  projects: unknown[];
  tasks: unknown[];
  tags: unknown[];
  entries: unknown[];
  pomodoroEvents: unknown[];
  gapDismissals: unknown[];
  auditLog: unknown[];
  settings: null;
  engineSnapshot: null;
} {
  const rnd = mulberry32(20260823);
  const uid = () => `s${(++counter).toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;

  const projects = [
    { id: "sp-aster", name: "Aster Labs", parentId: null, colorIndex: 0, billableByDefault: true, rateMinorPerHour: 12_000, goalTargetMs: 15 * HOUR, goalPeriod: "week" as const, archived: false, createdAt: nowWall - 30 * DAY },
    { id: "sp-borealis", name: "Borealis Design", parentId: null, colorIndex: 1, billableByDefault: true, rateMinorPerHour: 9_500, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: nowWall - 30 * DAY },
    { id: "sp-quokka", name: "Quokka Apps", parentId: null, colorIndex: 2, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: 5 * HOUR, goalPeriod: "week" as const, archived: false, createdAt: nowWall - 30 * DAY },
    { id: "sp-internal", name: "Admin & learning", parentId: null, colorIndex: 7, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: nowWall - 30 * DAY },
  ];
  const tasks = [
    { id: "st-1", projectId: "sp-aster", name: "Telemetry dashboard", done: false, createdAt: nowWall - 20 * DAY },
    { id: "st-2", projectId: "sp-aster", name: "Weekly sync", done: false, createdAt: nowWall - 20 * DAY },
    { id: "st-3", projectId: "sp-borealis", name: "Design system audit", done: false, createdAt: nowWall - 18 * DAY },
    { id: "st-4", projectId: "sp-quokka", name: "Prototype review", done: false, createdAt: nowWall - 10 * DAY },
  ];
  const tags = [
    { id: "sg-deep", name: "deep work" },
    { id: "sg-meeting", name: "meeting" },
    { id: "sg-admin", name: "admin" },
  ];

  const entries: unknown[] = [];
  const poms: unknown[] = [];
  const todayMidnightUtc = Math.floor(nowWall / DAY) * DAY;

  for (let d = 27; d >= 0; d--) {
    const dayStart = todayMidnightUtc - d * DAY + 8 * HOUR;
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (rnd() < 0.12) continue;
    let cursor = dayStart + Math.floor(8.4 * HOUR + rnd() * HOUR);
    const blocks = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < blocks; b++) {
      const roll = rnd();
      const project =
        roll < 0.45 ? "sp-aster"
        : roll < 0.75 ? "sp-borealis"
        : roll < 0.9 ? "sp-quokka"
        : "sp-internal";
      const task =
        project === "sp-aster" ? (b % 2 === 0 ? "st-1" : "st-2")
        : project === "sp-borealis" ? "st-3"
        : project === "sp-quokka" ? "st-4"
        : null;
      const tagIds = project === "sp-internal" ? ["sg-admin"] : rnd() < 0.6 ? ["sg-deep"] : ["sg-meeting"];
      const durMin = 25 + Math.floor(rnd() * 95);
      if (cursor + durMin * MIN > Math.min(dayStart + 19 * HOUR, nowWall - 2 * MIN)) break;
      const billableBase = project === "sp-aster" || project === "sp-borealis";
      entries.push({
        id: uid(),
        projectId: project,
        taskId: task,
        tagIds,
        billable: billableBase && rnd() > 0.05,
        startedWall: cursor,
        durationMs: durMin * MIN,
        note: "",
        source: rnd() > 0.25 ? "timer" : "manual",
        acknowledgedOverlapsWith: [],
        revisions: [],
        createdAt: cursor,
        editedAt: rnd() < 0.08 ? cursor + 3 * HOUR : null,
      });
      if (durMin >= 23 && durMin <= 28) {
        poms.push({ id: uid(), atWall: cursor, type: "workCompleted", durationMs: 25 * MIN, projectId: project });
      } else if (rnd() < 0.3) {
        poms.push({ id: uid(), atWall: cursor, type: "workAbandoned", durationMs: Math.max(5, durMin - 12) * MIN, projectId: project });
      }
      cursor += durMin * MIN + Math.floor(15 + rnd() * 70) * MIN;
    }
  }

  return {
    schemaVersion: 2,
    projects,
    tasks,
    tags,
    entries,
    pomodoroEvents: poms,
    gapDismissals: [],
    auditLog: [],
    settings: null,
    engineSnapshot: null,
  };
}
