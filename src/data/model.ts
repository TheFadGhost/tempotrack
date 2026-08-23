import type { AuditSource, Database, Entry, Revision } from "./schema.js";

let counter = 0;

/** Clock-free unique id: counter + entropy only (the data layer never reads time). */
export function uid(): string {
  counter = (counter + 1) % 1_000_000;
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff).toString(16);
  return `id-${counter.toString(36)}-${rnd}`;
}

export class ValidationError extends Error {}

const EDITABLE_ENTRY_FIELDS = new Set(["projectId", "taskId", "tagIds", "billable", "startedWall", "durationMs", "note"]);

function diffFields(before: Entry, after: Partial<Entry>): Record<string, [unknown, unknown]> {
  const fields: Record<string, [unknown, unknown]> = {};
  for (const key of EDITABLE_ENTRY_FIELDS) {
    const a = (before as unknown as Record<string, unknown>)[key];
    const b = (after as unknown as Record<string, unknown>)[key];
    if (b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) {
      fields[key] = [a, b];
    }
  }
  return fields;
}

export function recordRevision(entry: Entry, changes: Partial<Entry>, atWall: number, source: AuditSource): void {
  const fields = diffFields(entry, changes);
  if (Object.keys(fields).length === 0) return;
  const revision: Revision = { atWall, source, fields };
  entry.revisions.push(revision);
  entry.editedAt = atWall;
  Object.assign(entry, changes);
}

export interface ManualEntryInput {
  projectId: string;
  taskId: string | null;
  tagIds: string[];
  billable: boolean;
  startedWall: number;
  durationMs: number;
  note?: string;
}

export function validateManualEntry(
  db: Database,
  input: ManualEntryInput,
  nowWall: number,
): void {
  if (!Number.isSafeInteger(input.startedWall)) throw new ValidationError("Start time is not a valid timestamp.");
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new ValidationError("Duration must be greater than zero — use h:mm like 1:30.");
  }
  if (!db.projects.some((p) => p.id === input.projectId)) throw new ValidationError("Pick a project for this entry.");
  if (input.taskId && !db.tasks.some((t) => t.id === input.taskId && t.projectId === input.projectId)) {
    throw new ValidationError("That task does not belong to the chosen project.");
  }
  const end = input.startedWall + input.durationMs;
  if (end > nowWall + 5 * 60_000) {
    throw new ValidationError("This entry ends in the future. Check the start time and duration.");
  }
  if (input.startedWall < nowWall - 10 * 365 * 24 * 3_600_000) {
    throw new ValidationError("This start time is over ten years in the past.");
  }
}

export function addManualEntry(db: Database, input: ManualEntryInput, nowWall: number): Entry {
  validateManualEntry(db, input, nowWall);
  const entry: Entry = {
    id: uid(),
    projectId: input.projectId,
    taskId: input.taskId,
    tagIds: [...input.tagIds],
    billable: input.billable,
    startedWall: input.startedWall,
    durationMs: input.durationMs,
    note: input.note ?? "",
    source: "manual",
    acknowledgedOverlapsWith: [],
    revisions: [],
    createdAt: nowWall,
    editedAt: null,
  };
  db.entries.push(entry);
  return entry;
}

export function addTimerEntry(
  db: Database,
  input: ManualEntryInput & { source?: "timer" },
  nowWall: number,
): Entry {
  const entry = addManualEntry(db, input, nowWall);
  entry.source = input.source ?? "timer";
  return entry;
}

export function editEntry(
  db: Database,
  entryId: string,
  changes: Partial<Pick<Entry, "projectId" | "taskId" | "tagIds" | "billable" | "startedWall" | "durationMs" | "note">>,
  nowWall: number,
  source: AuditSource = "user",
): Entry {
  const entry = db.entries.find((e) => e.id === entryId);
  if (!entry) throw new ValidationError("Entry not found.");
  const merged = { ...entry, ...changes };
  validateManualEntry(
    db,
    {
      projectId: merged.projectId,
      taskId: merged.taskId,
      tagIds: merged.tagIds,
      billable: merged.billable,
      startedWall: merged.startedWall,
      durationMs: merged.durationMs,
      note: merged.note,
    },
    nowWall,
  );
  recordRevision(entry, changes, nowWall, source);
  return entry;
}

export function splitEntry(db: Database, entryId: string, splitAtWall: number, nowWall: number, source: AuditSource = "user"): [Entry, Entry] {
  const entry = db.entries.find((e) => e.id === entryId);
  if (!entry) throw new ValidationError("Entry not found.");
  const offset = splitAtWall - entry.startedWall;
  if (offset <= 0 || offset >= entry.durationMs) {
    throw new ValidationError("The split point must fall strictly inside the entry.");
  }
  const second: Entry = {
    ...structuredClone(entry),
    id: uid(),
    startedWall: splitAtWall,
    durationMs: entry.durationMs - offset,
    // The overlap acknowledgements covered the original span only; each half
    // must earn its own acknowledgement.
    acknowledgedOverlapsWith: [],
    revisions: [],
    createdAt: nowWall,
    editedAt: null,
  };
  recordRevision(entry, { durationMs: offset }, nowWall, source);
  const index = db.entries.findIndex((e) => e.id === entryId);
  db.entries.splice(index + 1, 0, second);
  return [entry, second];
}

export function deleteEntry(db: Database, entryId: string, nowWall: number): void {
  const index = db.entries.findIndex((e) => e.id === entryId);
  if (index === -1) throw new ValidationError("Entry not found.");
  const [removed] = db.entries.splice(index, 1);
  db.auditLog.push({
    atWall: nowWall,
    type: "entryDeleted",
    payload: { entry: structuredClone(removed) },
  });
}

export function createProject(
  db: Database,
  name: string,
  opts: { parentId?: string | null; colorIndex?: number; billableByDefault?: boolean; rateMinorPerHour?: number | null } = {},
  nowWall: number,
): Database["projects"][number] {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Project name cannot be empty.");
  if (db.projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase() && !p.archived)) {
    throw new ValidationError(`A project named "${trimmed}" already exists.`);
  }
  const project = {
    id: uid(),
    name: trimmed,
    parentId: opts.parentId ?? null,
    colorIndex: opts.colorIndex ?? db.projects.length % 8,
    billableByDefault: opts.billableByDefault ?? false,
    rateMinorPerHour: opts.rateMinorPerHour ?? null,
    goalTargetMs: null,
    goalPeriod: null,
    archived: false,
    createdAt: nowWall,
  };
  if (project.parentId && !db.projects.some((p) => p.id === project.parentId)) {
    throw new ValidationError("Parent project not found.");
  }
  db.projects.push(project);
  return project;
}

export function updateProject(db: Database, id: string, changes: Partial<Database["projects"][number]>, nowWall: number): void {
  const project = db.projects.find((p) => p.id === id);
  if (!project) throw new ValidationError("Project not found.");
  if (changes.rateMinorPerHour !== null && changes.rateMinorPerHour !== undefined) {
    if (!Number.isSafeInteger(changes.rateMinorPerHour) || changes.rateMinorPerHour < 0) {
      throw new ValidationError("Hourly rate must be a non-negative amount in minor units.");
    }
  }
  Object.assign(project, changes);
  db.auditLog.push({ atWall: nowWall, type: "projectUpdated", payload: { id, changes: structuredClone(changes) } });
}

export function createTask(db: Database, projectId: string, name: string, nowWall: number): Database["tasks"][number] {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Task name cannot be empty.");
  if (!db.projects.some((p) => p.id === projectId)) throw new ValidationError("Project not found.");
  const task = { id: uid(), projectId, name: trimmed, done: false, createdAt: nowWall };
  db.tasks.push(task);
  return task;
}

export function createTag(db: Database, name: string): Database["tags"][number] {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Tag name cannot be empty.");
  const existing = db.tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const tag = { id: uid(), name: trimmed };
  db.tags.push(tag);
  return tag;
}
