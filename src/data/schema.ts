export const SCHEMA_VERSION = 2;

export type EntrySource = "timer" | "manual";
export type AuditSource = "user" | "reconcile" | "overlapFix" | "idle";

export interface Revision {
  atWall: number;
  source: AuditSource;
  fields: Record<string, [unknown, unknown]>;
}

export interface Project {
  id: string;
  name: string;
  parentId: string | null;
  colorIndex: number;
  billableByDefault: boolean;
  rateMinorPerHour: number | null;
  /** Optional goal: target tracked time per period. */
  goalTargetMs: number | null;
  goalPeriod: "day" | "week" | null;
  archived: boolean;
  createdAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  done: boolean;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Entry {
  id: string;
  projectId: string;
  taskId: string | null;
  tagIds: string[];
  billable: boolean;
  /** Wall-clock epoch ms at placement start. Canonical placement end is startedWall + durationMs. */
  startedWall: number;
  /** Authoritative tracked duration. Never negative. */
  durationMs: number;
  note: string;
  source: EntrySource;
  acknowledgedOverlapsWith: string[];
  revisions: Revision[];
  createdAt: number;
  editedAt: number | null;
}

export type PomodoroEventType = "workCompleted" | "workAbandoned" | "breakCompleted" | "breakSkipped";

export interface PomodoroEvent {
  id: string;
  atWall: number;
  type: PomodoroEventType;
  durationMs: number;
  projectId: string | null;
}

export interface GapDismissal {
  dayKey: string;
  startWall: number;
  endWall: number;
}

export interface Settings {
  theme: "light" | "dark" | "dim" | "highContrast";
  weekStartsOn: 0 | 1;
  workingDays: number[];
  workdayStartMinute: number;
  workdayEndMinute: number;
  minReportedGapMs: number;
  idleThresholdMs: number;
  notificationsEnabled: boolean;
  currencyCode: string;
  pomodoro: {
    workMin: number;
    shortBreakMin: number;
    longBreakMin: number;
    longBreakEvery: number;
    autoStartNext: boolean;
  };
  daySpanStartMinute: number;
  daySpanEndMinute: number;
  onboarded: boolean;
}

export interface AuditLogEvent {
  atWall: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface Database {
  schemaVersion: number;
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  entries: Entry[];
  pomodoroEvents: PomodoroEvent[];
  gapDismissals: GapDismissal[];
  auditLog: AuditLogEvent[];
  settings: Settings;
  engineSnapshot: unknown | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  weekStartsOn: 1,
  workingDays: [1, 2, 3, 4, 5],
  workdayStartMinute: 9 * 60,
  workdayEndMinute: 17 * 60,
  minReportedGapMs: 5 * 60_000,
  idleThresholdMs: 5 * 60_000,
  notificationsEnabled: true,
  currencyCode: "USD",
  pomodoro: {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,
    autoStartNext: false,
  },
  daySpanStartMinute: 7 * 60,
  daySpanEndMinute: 22 * 60,
  onboarded: false,
};

export function emptyDatabase(nowWall: number): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: [],
    tasks: [],
    tags: [],
    entries: [],
    pomodoroEvents: [],
    gapDismissals: [],
    auditLog: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    engineSnapshot: null,
  };
}
