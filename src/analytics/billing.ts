import type { Database, Entry } from "../data/schema.js";
import { billableMinorUnits } from "../core/money.js";

/**
 * Billing rules, fixed once:
 *
 *  - All amounts are integer minor units (cents). Floats never touch money.
 *  - A project's rate is its own minorPerHour; if null, the nearest ancestor
 *    project with a rate is used; if none, the entry contributes no amount.
 *  - Rounding (half-up) is applied exactly once per entry to its final amount;
 *    line amounts are then summed. This matches invoice line-item semantics.
 */
export function effectiveRate(db: Database, projectId: string): number | null {
  let current = db.projects.find((p) => p.id === projectId) ?? null;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.rateMinorPerHour !== null) return current.rateMinorPerHour;
    current = current.parentId ? db.projects.find((p) => p.id === current!.parentId) ?? null : null;
  }
  return null;
}

export interface BillableLine {
  projectId: string;
  entries: number;
  billableMs: number;
  amountMinor: number;
}

export function billableLines(db: Database, entries: Entry[]): BillableLine[] {
  const byProject = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.billable) continue;
    const list = byProject.get(e.projectId);
    if (list) list.push(e);
    else byProject.set(e.projectId, [e]);
  }
  const lines: BillableLine[] = [];
  for (const [projectId, list] of byProject) {
    const rate = effectiveRate(db, projectId);
    if (rate === null) continue;
    let amountMinor = 0;
    let billableMs = 0;
    for (const e of list) {
      amountMinor += billableMinorUnits(e.durationMs, rate);
      billableMs += e.durationMs;
    }
    lines.push({ projectId, entries: list.length, billableMs, amountMinor });
  }
  return lines.sort((a, b) => a.projectId.localeCompare(b.projectId));
}
