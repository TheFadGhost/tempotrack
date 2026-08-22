import { h } from "../dom.js";
import type { UiContext } from "../main.js";
import { entriesToCsv } from "../../export/csv.js";
import { buildInvoiceModel, renderInvoiceHtml, type GroupBy } from "../../export/invoice.js";
import { formatHM } from "../../core/duration.js";

function monthStartIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function renderReports(ui: UiContext): void {
  const { app, main } = ui;
  const now = new Date(app.now());
  const app_ = app as unknown as { reportFrom?: string; reportTo?: string; reportGroup?: GroupBy; reportBillableOnly?: boolean };

  const fromInput = h("input", { type: "date", value: app_.reportFrom ?? monthStartIso(now) }) as HTMLInputElement;
  const toInput = h("input", { type: "date", value: app_.reportTo ?? todayIso(now) }) as HTMLInputElement;
  const groupSelect = h("select", { "aria-label": "Group by" },
    ...(["project", "task", "tag"] as GroupBy[]).map((g) => new Option(g, g, false, (app_.reportGroup ?? "project") === g)),
  ) as HTMLSelectElement;
  const billableOnly = h("input", { type: "checkbox" }) as HTMLInputElement;
  billableOnly.checked = app_.reportBillableOnly ?? false;

  const out = h("div");

  function compute(): void {
    while (out.firstChild) out.removeChild(out.firstChild);
    const startWall = new Date(`${fromInput.value}T00:00:00`).getTime();
    const endWall = new Date(`${toInput.value}T00:00:00`).getTime() + 86_400_000;
    if (!Number.isFinite(startWall) || !Number.isFinite(endWall)) {
      out.append(h("p", { class: "banner error" }, "Pick both a start and an end date."));
      return;
    }
    if (endWall <= startWall) {
      out.append(h("p", { class: "banner error" }, "The end date must be after the start date."));
      return;
    }
    if (startWall > app.now() + 60_000) {
      out.append(h("p", { class: "banner error" }, "This range is entirely in the future — there is nothing to report yet."));
      return;
    }

    let entries = app.db.entries.filter((e) => e.startedWall >= startWall && e.startedWall < endWall);
    if (billableOnly.checked) entries = entries.filter((e) => e.billable);

    app_.reportFrom = fromInput.value;
    app_.reportTo = toInput.value;
    app_.reportGroup = groupSelect.value as GroupBy;
    app_.reportBillableOnly = billableOnly.checked;

    if (entries.length === 0) {
      out.append(h("div", { class: "empty-note" }, "No entries in this range. Adjust the dates or record some time first."));
      return;
    }

    const model = buildInvoiceModel(app.db, entries, { groupBy: groupSelect.value as GroupBy, rangeStartWall: startWall, rangeEndWall: endWall, generatedAtWall: app.now() });
    const totalMs = entries.reduce((s, e) => s + e.durationMs, 0);

    const table = h("table", { class: "data" },
      h("thead", null, h("tr", null,
        h("th", null, `By ${groupSelect.value}`),
        h("th", { class: "n" }, "Time (h:mm)"),
        h("th", { class: "n" }, "Billable hours"),
        h("th", { class: "n" }, `Amount (${app.db.settings.currencyCode})`))),
      h("tbody", null,
        ...(model.lines.length === 0
          ? [h("tr", null, h("td", { colspan: "4" }, "No rated billable work in this range. Set hourly rates on projects to see amounts."))]
          : model.lines.map((l) =>
              h("tr", null,
                h("td", null, l.label),
                h("td", { class: "n" }, "—"),
                h("td", { class: "n" }, formatHM(l.billableMs)),
                h("td", { class: "n report-money" }, minorToStr(l.amountMinor)))))),
      h("tfoot", null, h("tr", null,
        h("td", null, `Total (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`),
        h("td", { class: "n" }, formatHM(totalMs)),
        h("td", { class: "n" }, formatHM(model.totalMs)),
        h("td", { class: "n report-money" }, minorToStr(model.totalAmountMinor)))));

    const overlapsNote = hasOverlaps(entries)
      ? h("p", { class: "muted" }, "Note: this range contains overlapping entries; their time is counted in each entry.")
      : null;

    out.append(table);
    if (overlapsNote) out.append(overlapsNote);
    out.append(
      h("div", { class: "row", style: "margin-top: var(--space-4)" },
        h("button", {
          onclick: () => download(`tempotrack-entries-${fromInput.value}-to-${toInput.value}.csv`, entriesToCsv(app.db, entries), "text/csv"),
        }, "Download CSV"),
        h("button", {
          onclick: () => download(`tempotrack-report-${fromInput.value}.json`, app.store.export(app.db, app.now()), "application/json"),
        }, "Export JSON"),
        h("button", {
          onclick: () => openPrintWindow(renderInvoiceHtml(buildInvoiceModel(app.db, entries, { groupBy: groupSelect.value as GroupBy, rangeStartWall: startWall, rangeEndWall: endWall, generatedAtWall: app.now() }))),
        }, "Print invoice-style summary"),
      ),
    );
  }

  main.append(
    h("h1", null, "Reports"),
    h("div", { class: "card" },
      h("div", { class: "row" },
        h("span", null, h("label", null, "From"), fromInput),
        h("span", null, h("label", null, "To"), toInput),
        h("span", null, h("label", null, "Group by"), groupSelect),
        h("span", { class: "row" }, billableOnly, h("span", null, "Billable only")),
        h("button", { class: "primary", onclick: () => compute() }, "Run report"),
      ),
    ),
    h("div", { style: "margin-top: var(--space-5)" }, out),
  );
  compute();
}

function hasOverlaps(entries: import("../../data/schema.js").Entry[]): boolean {
  const sorted = [...entries].sort((a, b) => a.startedWall - b.startedWall);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    if (prev.startedWall + prev.durationMs > sorted[i]!.startedWall) return true;
  }
  return false;
}

function minorToStr(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, "0")}`;
}

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openPrintWindow(html: string): void {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
}
