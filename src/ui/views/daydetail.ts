import { h } from "../dom.js";
import type { UiContext } from "../main.js";
import { findGaps, findOverlaps, spanOf } from "../../data/overlap.js";
import { formatHM } from "../../core/duration.js";
import { openEntryDialog, confirmDialog } from "../dialogs.js";
import { splitEntry } from "../../data/model.js";

export function dayDetail(ui: UiContext, dayStartWall: number): HTMLElement {
  const { app } = ui;
  const dayEndWall = dayStartWall + 86_400_000;
  const settings = app.db.settings;
  const entries = app.db.entries
    .filter((e) => e.startedWall >= dayStartWall && e.startedWall < dayEndWall)
    .sort((a, b) => a.startedWall - b.startedWall);

  const wrap = h("div", { class: "day-layout", style: "margin-top: var(--space-6)" });

  // Timeline
  const spanStart = settings.daySpanStartMinute;
  const spanEnd = settings.daySpanEndMinute;
  const spanMs = (spanEnd - spanStart) * 60_000;
  const timeline = h("div", { class: "timeline", role: "img", "aria-label": `Day timeline from ${minuteLabel(spanStart)} to ${minuteLabel(spanEnd)}` });
  for (let m = spanStart; m <= spanEnd; m += 120) {
    const top = ((m - spanStart) / (spanEnd - spanStart)) * 100;
    timeline.append(
      h("div", { class: "hour-line", style: `top:${top}%` }),
      h("div", { class: "hour-label", style: `top:${top}%` }, minuteLabel(m)),
    );
  }
  const lanes = computeLanes(entries);
  const laneWidth = 100 / Math.max(1, lanes.laneCount);
  for (const { entry, lane } of lanes.items) {
    const startMin = (entry.startedWall - dayStartWall) / 60_000;
    const endMin = startMin + entry.durationMs / 60_000;
    if (endMin <= spanStart || startMin >= spanEnd) continue;
    const top = (Math.max(startMin, spanStart) - spanStart) / (spanEnd - spanStart) * 100;
    const bottom = (Math.min(endMin, spanEnd) - spanStart) / (spanEnd - spanStart) * 100;
    const height = Math.max(0.8, bottom - top);
    const label = entry.durationMs >= 30 * 60_000 ? `${app.projectName(entry.projectId)} ${formatHM(entry.durationMs)}` : "";
    timeline.append(h("div", {
      class: "entry-block",
      style: `top:${top}%;height:${height}%;left:${8 + lane * laneWidth}%;width:calc(${laneWidth}% - 10px);background:${app.colorOf(entry.projectId)}`,
      title: `${timeLabel(entry.startedWall)}–${timeLabel(entry.startedWall + entry.durationMs)} · ${app.projectName(entry.projectId)}${entry.note ? " · " + entry.note : ""}`,
    }, label));
  }
  wrap.append(timeline);

  // Right column: flags + list
  const right = h("div");
  const gaps = findGaps(app.db, { dayStartWall, dayEndWall }, { startMinute: spanStart, endMinute: spanEnd }, settings.minReportedGapMs);
  const overlaps = findOverlaps(entries);

  if (gaps.length > 0 || overlaps.length > 0) {
    const flagList = h("ul", { class: "flag-list" });
    for (const gap of gaps) {
      flagList.append(h("li", null,
        h("span", { class: "muted num" }, `${timeLabel(gap.startWall)}–${timeLabel(gap.endWall)} · unaccounted ${formatHM(gap.durationMs)}`),
        h("span", { class: "row" },
          h("button", {
            onclick: () => {
              openEntryDialog(ui, null, { startedWall: gap.startWall, durationMs: gap.durationMs });
            },
          }, "Log this time"),
          h("button", {
            class: "subtle",
            onclick: () => {
              app.db.gapDismissals.push({ dayKey: String(dayStartWall), startWall: gap.startWall, endWall: gap.endWall });
              app.saveSoon();
              app.emit();
            },
          }, "Dismiss"),
        ),
      ));
    }
    for (const pair of overlaps) {
      const a = entries.find((e) => e.id === pair.aId)!;
      const b = entries.find((e) => e.id === pair.bId)!;
      flagList.append(h("li", null,
        h("span", { class: "muted" },
          `Overlap (${pair.kind}, ${formatHM(pair.overlapMs)} shared): ${app.projectName(a.projectId)} ↔ ${app.projectName(b.projectId)}`),
        h("button", {
          class: "subtle",
          onclick: () => resolveOverlap(ui, a.id, b.id),
        }, "Trim earlier end"),
      ));
    }
    right.append(h("h2", null, "Needs reconciliation"), flagList);
  }

  right.append(h("h2", null, `Entries (${entries.length})`));
  if (entries.length === 0) {
    right.append(h("div", { class: "empty-note" }, "No time recorded on this day yet. Start the timer or add past time."));
  } else {
    const rows = entries.map((entry) => {
      const project = app.db.projects.find((p) => p.id === entry.projectId);
      const taskName = entry.taskId ? app.db.tasks.find((t) => t.id === entry.taskId)?.name ?? "" : "";
      return h("div", { class: "entry-row" },
        h("span", { class: "legend-dot", style: `background:${app.colorOf(entry.projectId)}`, "aria-hidden": "true" }),
        h("span", { class: "time num" }, `${timeLabel(entry.startedWall)}–${timeLabel(entry.startedWall + entry.durationMs)}`),
        h("span", { class: "dur num" }, formatHM(entry.durationMs)),
        h("span", { class: "grow" },
          app.projectName(entry.projectId),
          taskName ? h("span", { class: "muted" }, ` · ${taskName}`) : null,
          entry.source === "manual" ? h("span", { class: "faint" }, " · manual") : null,
          entry.editedAt !== null ? editedChip(entry.revisions.length) : null,
          overlapBadge(entry, overlaps),
        ),
        billableCell(ui, entry),
        h("span", { class: "row" },
          h("button", { class: "subtle", "aria-label": `Edit entry at ${timeLabel(entry.startedWall)}`, onclick: () => openEntryDialog(ui, entry) }, "Edit"),
          h("button", { class: "subtle", "aria-label": `Split entry at ${timeLabel(entry.startedWall)}`, onclick: () => splitAtHalfway(ui, entry) }, "Split"),
          h("button", {
            class: "subtle danger",
            "aria-label": `Delete entry at ${timeLabel(entry.startedWall)}`,
            onclick: () => confirmDialog(ui, "Delete this entry?", () => {
              app.db.entries = app.db.entries.filter((e) => e.id !== entry.id);
              app.db.auditLog.push({ atWall: app.now(), type: "entryDeleted", payload: { entry } });
              app.saveSoon();
              app.emit();
            }),
          }, "Delete"),
        ),
      );
    });
    right.append(...rows);
  }
  wrap.append(right);
  return wrap;
}

function editedChip(revisionCount: number): HTMLElement {
  return h("span", { class: "edited-chip", title: `Edited ${revisionCount} time(s); full history in the edit dialog.` }, "edited");
}

function overlapBadge(entry: import("../../data/schema.js").Entry, pairs: ReturnType<typeof findOverlaps>): Node | null {
  const involved = pairs.some((p) => p.aId === entry.id || p.bId === entry.id);
  return involved ? h("span", { class: "edited-chip", title: "This entry overlaps another." }, "overlap") : null;
}

function billableCell(ui: UiContext, entry: import("../../data/schema.js").Entry): Node | null {
  const { app } = ui;
  if (!entry.billable) return null;
  const rate = effectiveRateOf(app, entry.projectId);
  if (rate === null) return h("span", { class: "faint" }, "billable (no rate)");
  const numerator = entry.durationMs * rate;
  const q = Math.floor(numerator / 3_600_000);
  const amountMinor = 2 * (numerator - q * 3_600_000) >= 3_600_000 ? q + 1 : q;
  const major = `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
  return h("span", { class: "report-money" }, `${major} ${app.db.settings.currencyCode}`);
}

function effectiveRateOf(app: UiContext["app"], projectId: string): number | null {
  let current = app.db.projects.find((p) => p.id === projectId) ?? null;
  while (current) {
    if (current.rateMinorPerHour !== null) return current.rateMinorPerHour;
    current = current.parentId ? app.db.projects.find((p) => p.id === current!.parentId) ?? null : null;
  }
  return null;
}

function splitAtHalfway(ui: UiContext, entry: import("../../data/schema.js").Entry): void {
  const { app } = ui;
  const midpoint = entry.startedWall + Math.floor(entry.durationMs / 2 / 60_000) * 60_000;
  try {
    splitEntry(app.db, entry.id, midpoint, app.now());
    app.saveSoon();
    app.emit();
  } catch (err) {
    app.showError(String((err as Error).message));
  }
}

function resolveOverlap(ui: UiContext, aId: string, bId: string): void {
  const { app } = ui;
  const a = app.db.entries.find((e) => e.id === aId)!;
  const b = app.db.entries.find((e) => e.id === bId)!;
  const earlier = a.startedWall <= b.startedWall ? a : b;
  const later = earlier === a ? b : a;
  const earlierEnd = earlier.startedWall + earlier.durationMs;
  const newDur = later.startedWall - earlier.startedWall;
  if (newDur <= 0) {
    app.showError("These entries touch already; trimming would delete one entirely.");
    return;
  }
  earlier.durationMs = newDur;
  earlier.editedAt = app.now();
  earlier.revisions.push({ atWall: Date.now(), source: "overlapFix", fields: { durationMs: [earlierEnd - earlier.startedWall, newDur] } });
  earlier.acknowledgedOverlapsWith.push(later.id);
  later.acknowledgedOverlapsWith.push(earlier.id);
  app.saveSoon();
  app.emit();
}

export function computeLanes(entries: import("../../data/schema.js").Entry[]): { items: { entry: import("../../data/schema.js").Entry; lane: number }[]; laneCount: number } {
  const items: { entry: import("../../data/schema.js").Entry; lane: number }[] = [];
  let laneCount = 1;
  const active: { id: string; end: number; lane: number }[] = [];
  for (const entry of [...entries].sort((a, b) => a.startedWall - b.startedWall)) {
    const span = spanOf(entry);
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= span.startWall) active.splice(i, 1);
    }
    const used = new Set(active.map((a) => a.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    laneCount = Math.max(laneCount, lane + 1);
    active.push({ id: entry.id, end: span.endWall, lane });
    items.push({ entry, lane });
  }
  return { items, laneCount };
}

function minuteLabel(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function timeLabel(wallMs: number): string {
  return new Date(wallMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
