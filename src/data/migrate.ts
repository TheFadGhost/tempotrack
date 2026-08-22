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
    return { ...db, schemaVersion: 2, settings };
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
  return current as unknown as Database;
}
