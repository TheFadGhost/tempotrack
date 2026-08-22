import { describe, expect, it } from "vitest";
import { MemoryPersistence, DataStore } from "../../src/data/store.js";
import { migrateDatabase } from "../../src/data/migrate.js";
import { SCHEMA_VERSION, emptyDatabase } from "../../src/data/schema.js";

const NOW = 1_700_000_000_000;

function seededDb(): ReturnType<typeof emptyDatabase> {
  const db = emptyDatabase(NOW);
  db.projects.push({ id: "p1", name: "Aster Labs", parentId: null, colorIndex: 0, billableByDefault: true, rateMinorPerHour: 12_000, archived: false, createdAt: NOW });
  db.entries.push({
    id: "e1", projectId: "p1", taskId: null, tagIds: [], billable: true,
    startedWall: NOW, durationMs: 3_600_000, note: "", source: "timer",
    acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null,
  });
  return db;
}

describe("DataStore atomicity and recovery", () => {
  it("round-trips a database exactly", () => {
    const store = new DataStore(new MemoryPersistence());
    const db = seededDb();
    store.save(db);
    expect(store.load()).toEqual(db);
  });

  it("a crash during staging leaves the previous good data intact", () => {
    const mem = new MemoryPersistence();
    const store = new DataStore(mem);
    store.save(seededDb());
    mem.failNextWriteWith = new Error("simulated crash");
    expect(() => store.save(seededDb())).toThrow("simulated crash");
    expect(store.load()).not.toBeNull();
    expect(store.load()!.entries).toHaveLength(1);
  });

  it("a truncated main payload falls back to the previous good save", () => {
    const mem = new MemoryPersistence();
    const store = new DataStore(mem);
    const first = seededDb();
    first.entries[0]!.note = "first";
    store.save(first);

    const second = seededDb();
    second.entries[0]!.note = "second";
    store.save(second); // backup now holds "first"

    const main = JSON.parse(mem.map.get("tempotrack.data.v2")!);
    mem.map.set("tempotrack.data.v2", JSON.stringify(main).slice(0, 40)); // truncate
    const loaded = store.load()!;
    expect(loaded.entries[0]!.note).toBe("first");
    expect(loaded.entries).toHaveLength(1);
  });

  it("corrupt-but-parseable payloads fail the checksum and fall back", () => {
    const mem = new MemoryPersistence();
    const store = new DataStore(mem);
    const first = seededDb();
    first.entries[0]!.note = "first";
    store.save(first);
    store.save(seededDb()); // backup = "first"

    const env = JSON.parse(mem.map.get("tempotrack.data.v2")!);
    const tampered = JSON.parse(env.data);
    tampered.entries[0].durationMs = 999;
    env.data = JSON.stringify(tampered);
    mem.map.set("tempotrack.data.v2", JSON.stringify(env));
    const loaded = store.load()!;
    expect(loaded.entries[0]!.note).toBe("first");
    expect(loaded.entries[0]!.durationMs).toBe(3_600_000);
  });

  it("tampered data with no fallback loads as null instead of trusting it", () => {
    const mem = new MemoryPersistence();
    const store = new DataStore(mem);
    store.save(seededDb());
    const env = JSON.parse(mem.map.get("tempotrack.data.v2")!);
    env.checksum = "deadbeef";
    mem.map.set("tempotrack.data.v2", JSON.stringify(env));
    expect(store.load()).toBeNull();
  });

  it("an empty store loads as null", () => {
    expect(new DataStore(new MemoryPersistence()).load()).toBeNull();
  });

  it("export round-trips through restoreFromExport with totals identical", () => {
    const mem = new MemoryPersistence();
    const store = new DataStore(mem);
    const db = seededDb();
    const text = store.export(db, NOW);
    const restored = store.restoreFromExport(text);
    expect(restored.entries).toEqual(db.entries);
    expect(restored.projects).toEqual(db.projects);
  });
});

describe("migrations", () => {
  it("v1 databases gain v2 settings defaults and keep their data", () => {
    const legacy = {
      schemaVersion: 1,
      projects: [{ id: "p1", name: "Old" }],
      entries: [],
      settings: { theme: "dark", notificationsEnabled: false },
    };
    const migrated = migrateDatabase(legacy)!;
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.settings.theme).toBe("dark");
    expect(migrated.settings.notificationsEnabled).toBe(false);
    expect(migrated.settings.workdayStartMinute).toBe(9 * 60);
    expect(migrated.projects[0]!.name).toBe("Old");
  });

  it("unknown future versions refuse to load rather than guess", () => {
    expect(migrateDatabase({ schemaVersion: 99, projects: [], entries: [] })).toBeNull();
  });
});
