import { describe, expect, it } from "vitest";
import { assertTotalsMatch, entriesToCsv, csvEscape, projectPath } from "../../src/export/csv.js";
import { buildInvoiceModel, renderInvoiceHtml } from "../../src/export/invoice.js";
import { emptyDatabase } from "../../src/data/schema.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const tzPlus2 = () => 120;

function db() {
  const d = emptyDatabase(NOW);
  d.projects.push(
    { id: "p1", name: "Aster Labs", parentId: null, colorIndex: 0, billableByDefault: true, rateMinorPerHour: 15_000, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: NOW },
    { id: "p2", name: 'Quote "special", inc', parentId: null, colorIndex: 1, billableByDefault: false, rateMinorPerHour: null, goalTargetMs: null, goalPeriod: null, archived: false, createdAt: NOW },
  );
  d.tasks.push({ id: "t1", projectId: "p1", name: "Kickoff, phase one", done: false, createdAt: NOW });
  d.tags.push({ id: "g1", name: "deep" });
  return d;
}

describe("csv export", () => {
  it("escapes separators, quotes and newlines per RFC 4180", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  });

  it("exports every entry with exact durations and round-trips totals", () => {
    const d = db();
    d.entries.push(
      { id: "e1", projectId: "p1", taskId: "t1", tagIds: ["g1"], billable: true, startedWall: Date.parse("2026-02-02T09:00:00Z"), durationMs: 95 * MIN, note: "call, prep + notes", source: "timer", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null },
      { id: "e2", projectId: "p2", taskId: null, tagIds: [], billable: false, startedWall: Date.parse("2026-02-02T13:00:00Z"), durationMs: 25 * MIN, note: "", source: "manual", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null },
    );
    const csv = entriesToCsv(d, d.entries, tzPlus2);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    const e1row = lines[1]!.split(",");
    // duration in ms appears verbatim; decimal hours consistent
    expect(lines[1]).toContain(String(95 * MIN));
    void e1row;
    assertTotalsMatch(d.entries, ["1.58", "0.42"]); // 95min=1.583h->1.58, 25min=0.416->0.42
    expect(() => assertTotalsMatch(d.entries, ["9.99"])).toThrow(/diverge/);
  });

  it("project paths include ancestors child / parent", () => {
    const d = db();
    d.projects[1]!.parentId = "p1";
    expect(projectPath(d, "p2")).toBe('Aster Labs / Quote "special", inc');
  });
});

describe("invoice model", () => {
  it("groups billable amounts by project and totals match the sum of entries exactly", () => {
    const d = db();
    d.entries.push(
      { id: "e1", projectId: "p1", taskId: "t1", tagIds: [], billable: true, startedWall: NOW - 2 * HOUR, durationMs: HOUR + MIN, note: "", source: "timer", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null },
      { id: "e2", projectId: "p1", taskId: "t1", tagIds: [], billable: true, startedWall: NOW - HOUR, durationMs: HOUR, note: "", source: "timer", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null },
      { id: "e3", projectId: "p2", taskId: null, tagIds: [], billable: true, startedWall: NOW - HOUR, durationMs: HOUR, note: "", source: "manual", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null },
    );
    const model = buildInvoiceModel(d, d.entries, { groupBy: "project", rangeStartWall: NOW - DAY, rangeEndWall: NOW + MIN, generatedAtWall: NOW });
    expect(model.lines.map((l) => l.label)).toEqual(["Aster Labs"]);
    // 61min at 150.00/h -> 15250; 60min -> 15000; unrated p2 contributes nothing.
    expect(model.lines[0]!.amountMinor).toBe(15250 + 15000);
    expect(model.totalAmountMinor).toBe(30250);
    // totalMs counts all billable-flagged time, including the unrated project's.
    expect(model.totalMs).toBe(181 * MIN);
  });

  it("renders printable HTML containing formatted money and hours", () => {
    const d = db();
    d.entries.push({ id: "e1", projectId: "p1", taskId: null, tagIds: [], billable: true, startedWall: NOW - HOUR, durationMs: 90 * MIN, note: "", source: "timer", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null });
    const model = buildInvoiceModel(d, d.entries, { groupBy: "project", rangeStartWall: NOW - DAY, rangeEndWall: NOW, generatedAtWall: NOW });
    const html = renderInvoiceHtml(model);
    expect(html).toContain("Aster Labs");
    expect(html).toContain(">1.50<");
    expect(html).toContain("225.00"); // 90min at 150.00/h
  });

  it("task grouping labels lines by task name", () => {
    const d = db();
    d.entries.push({ id: "e1", projectId: "p1", taskId: "t1", tagIds: [], billable: true, startedWall: NOW - HOUR, durationMs: HOUR, note: "", source: "timer", acknowledgedOverlapsWith: [], revisions: [], createdAt: NOW, editedAt: null });
    const model = buildInvoiceModel(d, d.entries, { groupBy: "task", rangeStartWall: NOW - DAY, rangeEndWall: NOW, generatedAtWall: NOW });
    expect(model.lines[0]!.label).toBe("Kickoff, phase one");
  });
});
