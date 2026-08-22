import { open, seal } from "./integrity.js";
import { migrateDatabase } from "./migrate.js";
import { emptyDatabase, SCHEMA_VERSION, type Database } from "./schema.js";

/**
 * Key-value persistence abstraction. The browser implementation wraps
 * localStorage; tests use an in-memory map that can simulate crashes between
 * individual writes.
 */
export interface KeyValuePersistence {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryPersistence implements KeyValuePersistence {
  readonly map = new Map<string, string>();
  /** When non-null the next write throws, simulating a crash mid-save. */
  failNextWriteWith: Error | null = null;

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    if (this.failNextWriteWith) {
      const err = this.failNextWriteWith;
      this.failNextWriteWith = null;
      throw err;
    }
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

export class LocalStoragePersistence implements KeyValuePersistence {
  constructor(private readonly storage: Storage) {}

  get(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch (err) {
      throw new Error(`Saving failed — the browser storage is full or unavailable. (${String(err)})`);
    }
  }

  remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      // best effort
    }
  }
}

export const STORAGE_KEYS = {
  main: "tempotrack.data.v2",
  staging: "tempotrack.data.v2.staging",
  backup: "tempotrack.data.v2.prev",
};

/**
 * Crash-safe store. A save never overwrites the last known-good payload in
 * place: it stages the sealed envelope first, rotates the previous good data
 * to a backup key, then commits. Loads verify checksums and fall back through
 * main -> staging -> backup, so a crash or truncation at any point loses
 * nothing that was ever successfully saved.
 */
export class DataStore {
  constructor(private readonly persistence: KeyValuePersistence) {}

  load(): Database | null {
    for (const key of [STORAGE_KEYS.main, STORAGE_KEYS.staging, STORAGE_KEYS.backup]) {
      const raw = this.persistence.get(key);
      const dataJson = open(raw);
      if (dataJson === null) continue;
      try {
        const parsed = JSON.parse(dataJson);
        const db = migrateDatabase(parsed);
        if (db !== null) return db;
      } catch {
        // fall through to next candidate
      }
    }
    return null;
  }

  save(db: Database): void {
    db.schemaVersion = SCHEMA_VERSION;
    const json = JSON.stringify(seal(JSON.stringify(db)));
    const prev = this.persistence.get(STORAGE_KEYS.main);
    this.persistence.set(STORAGE_KEYS.staging, json);
    if (prev !== null) this.persistence.set(STORAGE_KEYS.backup, prev);
    this.persistence.set(STORAGE_KEYS.main, json);
    this.persistence.remove(STORAGE_KEYS.staging);
  }

  /**
   * Restores a user-provided file. Accepts a full export (with .database), a
   * raw sealed envelope (as written by save), or a bare migrated database.
   */
  restoreFromExport(text: string): Database {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("This file is not valid JSON.");
    }
    let inner: unknown = parsed;
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if ("database" in obj) inner = obj.database;
      else if (obj.app === "tempotrack" && typeof obj.data === "string") {
        const opened = open(text);
        if (opened === null) throw new Error("This backup failed its integrity check.");
        inner = JSON.parse(opened);
      }
    }
    const db = migrateDatabase(inner);
    if (db === null) throw new Error("This file is not a valid Tempotrack export.");
    return db;
  }

  export(db: Database, nowWall: number): string {
    return JSON.stringify({ app: "tempotrack", exportedAtWall: nowWall, database: db }, null, 2);
  }
}

export function freshDatabase(nowWall: number): Database {
  return emptyDatabase(nowWall);
}
