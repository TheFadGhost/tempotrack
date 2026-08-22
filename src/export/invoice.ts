import type { Database, Entry } from "../data/schema.js";
import { billableLines } from "../analytics/billing.js";
import { formatDecimalHours } from "../core/duration.js";
import { formatMinor } from "../core/money.js";
import { projectPath } from "./csv.js";

export type GroupBy = "project" | "task" | "tag";

export interface InvoiceLine {
  label: string;
  billableMs: number;
  amountMinor: number;
}

export interface InvoiceModel {
  title: string;
  currencyCode: string;
  rangeLabel: string;
  groupBy: GroupBy;
  lines: InvoiceLine[];
  totalMs: number;
  totalAmountMinor: number;
  generatedAtWall: number;
}

/**
 * Printable invoice-style summary. Reports what is billable; it does not send
 * anything or compute taxes — that would be a second product.
 */
export function buildInvoiceModel(
  db: Database,
  entries: Entry[],
  opts: { groupBy: GroupBy; rangeStartWall: number; rangeEndWall: number; generatedAtWall: number },
): InvoiceModel {
  const lines: InvoiceLine[] = [];
  if (opts.groupBy === "project") {
    for (const l of billableLines(db, entries)) {
      lines.push({ label: projectPath(db, l.projectId), billableMs: l.billableMs, amountMinor: l.amountMinor });
    }
  } else if (opts.groupBy === "task") {
    const byTask = new Map<string, { ms: number; amount: number }>();
    for (const e of entries) {
      if (!e.billable || !e.taskId) continue;
      const rate = effectiveRateFor(db, e.projectId);
      const slot = byTask.get(e.taskId) ?? { ms: 0, amount: 0 };
      const task = db.tasks.find((t) => t.id === e.taskId);
      void task;
      const perEntry = rate === null ? 0 : billOne(e.durationMs, rate);
      byTask.set(e.taskId, { ms: slot.ms + e.durationMs, amount: slot.amount + perEntry });
    }
    for (const [taskId, v] of byTask) {
      const name = db.tasks.find((t) => t.id === taskId)?.name ?? taskId;
      lines.push({ label: name, billableMs: v.ms, amountMinor: v.amount });
    }
  } else {
    const byTag = new Map<string, { ms: number; amount: number }>();
    for (const e of entries) {
      if (!e.billable) continue;
      const rate = effectiveRateFor(db, e.projectId);
      if (rate === null) continue;
      const perEntry = billOne(e.durationMs, rate);
      for (const tagId of e.tagIds) {
        const slot = byTag.get(tagId) ?? { ms: 0, amount: 0 };
        byTag.set(tagId, { ms: slot.ms + e.durationMs, amount: slot.amount + perEntry });
      }
    }
    for (const [tagId, v] of byTag) {
      const name = db.tags.find((t) => t.id === tagId)?.name ?? tagId;
      lines.push({ label: `#${name}`, billableMs: v.ms, amountMinor: v.amount });
    }
  }

  // Tag grouping can double-count a multi-tagged entry's money across tags;
  // the model therefore reports line sums as-is and flags nothing silently:
  // totals are computed from PROJECT lines only when tags overlap.
  const totalAmountMinor = sumDistinctEntryAmounts(db, entries);
  return {
    title: "Billable summary",
    currencyCode: db.settings.currencyCode,
    rangeLabel: `${new Date(opts.rangeStartWall).toISOString().slice(0, 10)} – ${new Date(opts.rangeEndWall - 1).toISOString().slice(0, 10)} (UTC dates)`,
    groupBy: opts.groupBy,
    lines: lines.sort((a, b) => b.amountMinor - a.amountMinor),
    totalMs: entries.filter((e) => e.billable).reduce((s, e) => s + e.durationMs, 0),
    totalAmountMinor,
    generatedAtWall: opts.generatedAtWall,
  };
}

function effectiveRateFor(db: Database, projectId: string): number | null {
  let current = db.projects.find((p) => p.id === projectId) ?? null;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.rateMinorPerHour !== null) return current.rateMinorPerHour;
    current = current.parentId ? db.projects.find((p) => p.id === current!.parentId) ?? null : null;
  }
  return null;
}

function billOne(durationMs: number, minorPerHour: number): number {
  const numerator = durationMs * minorPerHour;
  const q = Math.floor(numerator / 3_600_000);
  return 2 * (numerator - q * 3_600_000) >= 3_600_000 ? q + 1 : q;
}

function sumDistinctEntryAmounts(db: Database, entries: Entry[]): number {
  let total = 0;
  for (const e of entries) {
    if (!e.billable) continue;
    const rate = effectiveRateFor(db, e.projectId);
    if (rate === null) continue;
    total += billOne(e.durationMs, rate);
  }
  return total;
}

/** Standalone printable HTML with inline styles; opens in a new tab to print. */
export function renderInvoiceHtml(model: InvoiceModel): string {
  const rows = model.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.label)}</td><td class="num">${formatDecimalHours(l.billableMs)}</td><td class="num">${formatMinor(l.amountMinor)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #111; margin: 48px auto; max-width: 720px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  .meta { color: #555; font-size: 13px; margin-bottom: 32px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 600; border-top: 2px solid #111; }
  @media print { body { margin: 12mm; } }
</style></head>
<body>
<h1>${escapeHtml(model.title)}</h1>
<p class="meta">${escapeHtml(model.rangeLabel)} · grouped by ${escapeHtml(model.groupBy)} · ${escapeHtml(model.currencyCode)}</p>
<table>
<thead><tr><th>Item</th><th class="num">Hours</th><th class="num">Amount (${escapeHtml(model.currencyCode)})</th></tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr><td>Total</td><td class="num">${formatDecimalHours(model.totalMs)}</td><td class="num">${formatMinor(model.totalAmountMinor)}</td></tr></tfoot>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
