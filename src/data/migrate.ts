import { SCHEMA_VERSION, type Database, type Settings } from "./schema.js";
import { DEFAULT_SETTINGS } from "./schema.js";

type Migration = (db: Record<string, unknown>) => Record<string, unknown>;

/**
 * v1 -> v2: settings gained workday/day-span and gap fields; older databases
 * receive the defaults. Entry shape unchanged.
 */
const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    const settings = { ...DEFAULT_SETTINGS, ...(db.settings as Partial<Settings> | undefined) };
    return {
      ...db,
      schemaVersion: 2,
      settings,
      tasks: Array.isArray(db.tasks) ? db.tasks : [],
      tags: Array.isArray(db.tags) ? db.tags : [],
      pomodoroEvents: Array.isArray(db.pomodoroEvents) ? db.pomodoroEvents : [],
      gapDismissals: Array.isArray(db.gapDismissals) ? db.gapDismissals : [],
      auditLog: Array.isArray(db.auditLog) ? db.auditLog : [],
      engineSnapshot: db.engineSnapshot ?? null,
    };
  },
};

export function migrateDatabase(parsed: unknown): Database | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const db = parsed as Record<string, unknown>;
  let version = typeof db.schemaVersion === "number" ? db.schemaVersion : 0;
  if (!Array.isArray(db.projects) || !Array.isArray(db.entries)) {
    if (version >= 1) return null;
  }
  let current = structuredClone(db);
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null;
    current = step(current);
    version = current.schemaVersion as number;
  }
  if (version !== SCHEMA_VERSION) return null;
  if (!isShapedLikeCurrentDatabase(current)) return null;
  return current as unknown as Database;
}

/** Structural checks so a truncated or foreign file can never masquerade as a database. */
function isShapedLikeCurrentDatabase(db: Record<string, unknown>): boolean {
  for (const key of ["projects", "tasks", "tags", "entries", "pomodoroEvents", "gapDismissals", "auditLog"]) {
    if (!Array.isArray(db[key])) return false;
  }
  const settings = db.settings as Record<string, unknown> | undefined | null;
  if (typeof settings !== "object" || settings === null) return false;
  const pomodoro = settings.pomodoro as Record<string, unknown> | undefined;
  if (typeof pomodoro !== "object" || pomodoro === null) return false;
  for (const field of ["workMin", "shortBreakMin", "longBreakMin", "longBreakEvery", "autoStartNext"]) {
    if (!(field in pomodoro)) return false;
  }
  for (const field of ["theme", "weekStartsOn", "workingDays", "currencyCode", "idleThresholdMs", "minReportedGapMs"]) {
    if (!(field in settings)) return false;
  }
  for (const raw of db.entries as unknown[]) {
    const e = raw as Record<string, unknown>;
    if (typeof e !== "object" || e === null) return false;
    if (typeof e.id !== "string" || typeof e.projectId !== "string") return false;
    if (typeof e.startedWall !== "number" || typeof e.durationMs !== "number") return false;
    if (!Array.isArray(e.revisions) || !Array.isArray(e.tagIds)) return false;
  }
  return true;
}
