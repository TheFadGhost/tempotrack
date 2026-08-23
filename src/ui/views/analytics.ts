import { h } from "../dom.js";
import type { UiContext } from "../main.js";
import { dailyTotals, totalsByProject, totalsByTag, weekdayHourHeatmap } from "../../analytics/aggregate.js";
import { averageSessionLengthMs, focusStreaks, pomodoroCompletion, weekOverWeekDeltaMs } from "../../analytics/metrics.js";
import { goalProgress } from "../../analytics/goals.js";
import { dayKeyOf, startOfDayWall, startOfWeek, addDays, systemTzOffset } from "../../analytics/time.js";
import { formatHM } from "../../core/duration.js";

type Period = "week" | "last7" | "last28" | "month";
const PERIODS: [Period, string][] = [
  ["week", "This week"],
  ["last7", "Last 7 days"],
  ["last28", "Last 4 weeks"],
  ["month", "This calendar month"],
];

export function renderAnalytics(ui: UiContext): void {
  const { app, main } = ui;
  const period = (app.analyticsPeriod ?? "last7") as Period;
  const tz = systemTzOffset;
  const today = app.dayKeyOf(app.now());

  const dayKeys = dayKeysFor(period, today, tz, app.db.settings.weekStartsOn, app.now());
  const totals = dailyTotals(app.db, dayKeys, tz);
  const focusedTotal = totals.reduce((s, t) => s + t.focusedMs, 0);
  const billableTotal = totals.reduce((s, t) => s + t.billableFocusedMs, 0);

  main.append(
    h("div", { class: "row spread" },
      h("h1", null, "Analytics"),
      h("select", { "aria-label": "Period", onchange: (ev: Event) => { app.analyticsPeriod = (ev.target as HTMLSelectElement).value; app.emit(); } },
        ...PERIODS.map(([p, label]) => new Option(label, p, false, p === period)),
      ),
    ),
    statCards(ui, focusedTotal, billableTotal, dayKeys, tz),
    heatmapSection(ui, dayKeys, tz),
    weeklyCompareSection(ui, today, tz),
    breakdownSections(ui, dayKeys, tz),
    pomodoroSection(ui, dayKeys, tz),
    goalsSection(ui, tz),
  );
}

function dayKeysFor(period: Period, today: string, tz: (w: number) => number, weekStartsOn: 0 | 1, nowWall: number): string[] {
  if (period === "week") {
    const start = startOfWeek(today, weekStartsOn, tz);
    return rangeKeys(start, 7, tz);
  }
  if (period === "last7") return rangeKeys(addDays(today, -6, tz), 7, tz);
  if (period === "last28") return rangeKeys(addDays(today, -27, tz), 28, tz);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const count = new Date(nowWall).getDate();
  return rangeKeys(firstOfMonth, count, tz);
}

function rangeKeys(startKey: string, n: number, tz: (w: number) => number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(addDays(startKey, i, tz));
  return keys;
}

function statCards(ui: UiContext, focusedTotal: number, billableTotal: number, dayKeys: string[], tz: (w: number) => number): HTMLElement {
  const { app } = ui;
  const avg = averageSessionLengthMs(app.db, dayKeys, tz);
  const streaks = focusStreaks(
    lastNDayTotals(app, 90, tz),
    25 * 60_000,
    true,
  );
  return h("div", { class: "stat-cards", style: "margin-bottom: var(--space-5)" },
    statCard("Focused", formatHM(focusedTotal)),
    statCard("Billable", formatHM(billableTotal)),
    statCard("Average session", avg === null ? "—" : formatHM(avg)),
    statCard("Focus streak", `${streaks.current} d`, `longest ${streaks.longest} d`),
  );
}

function lastNDayTotals(app: UiContext["app"], n: number, tz: (w: number) => number) {
  const today = app.dayKeyOf(app.now());
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(dayKeyOf(app.startDayWall(today) - i * 86_400_000 + 12 * 3_600_000, tz));
  void startOfDayWall;
  return dailyTotals(app.db, keys, tz);
}

function statCard(label: string, value: string, sub?: string): HTMLElement {
  return h("div", { class: "card" },
    h("div", { class: "muted" }, label),
    h("div", { class: "num", style: "font-size:20px;font-weight:600" }, value),
    sub ? h("div", { class: "faint" }, sub) : null,
  );
}

function heatmapSection(ui: UiContext, dayKeys: string[], tz: (w: number) => number): HTMLElement {
  const { app } = ui;
  const { cells, occurrencesPerWeekday } = weekdayHourHeatmap(app.db, dayKeys, tz);
  const grid = h("div", { class: "heatmap", role: "grid", "aria-label": "Average focused minutes by weekday and hour" });
  const headerRow = h("div", { role: "row" });
  headerRow.append(h("span", { class: "hm-label" }));
  for (let hour = 0; hour < 24; hour += 3) {
    headerRow.append(h("span", { class: "hm-label", style: `grid-column:${hour + 2}` }, `${String(hour).padStart(2, "0")}`));
  }
  grid.append(headerRow);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  cells.forEach((row, wd) => {
    const rowEl = h("div", { role: "row" });
    rowEl.append(h("span", { class: "hm-label", role: "rowheader" }, weekdays[wd]!));
    row.forEach((avgMin, hour) => {
      const hasData = occurrencesPerWeekday[wd]! > 0;
      const isTrueZero = hasData && avgMin <= 0;
      const level =
        !hasData || avgMin <= 0 ? 0
        : avgMin <= 10 ? 1
        : avgMin <= 25 ? 2
        : avgMin <= 45 ? 3
        : 4;
      const valueText = hasData ? `${Math.round(avgMin)} min average` : "no data";
      rowEl.append(h("div", {
        class: `hm-cell${isTrueZero ? " hm-zero" : ""}`,
        style: level > 0 ? `background:var(--chart-ramp-${level + 1})` : "",
        title: `${weekdays[wd]} ${String(hour).padStart(2, "0")}:00 — ${valueText}`,
        role: "gridcell",
        "aria-label": `${weekdays[wd]} ${String(hour).padStart(2, "0")}:00: ${valueText}`,
      }));
    });
    grid.append(rowEl);
  });
  return section("When focus happens", grid,
    h("p", { class: "muted" }, "Cell = average focused minutes in that weekday-hour across the period. Outlined empty cells mean no data; dashed zero cells mean the days existed but no time was recorded in that hour."));
}

function weeklyCompareSection(ui: UiContext, today: string, tz: (w: number) => number): HTMLElement {
  const { app } = ui;
  const weeks: { key: string; total: number }[] = [];
  let cursor = startOfWeek(today, app.db.settings.weekStartsOn, tz);
  for (let i = 0; i < 4; i++) {
    const keys = rangeKeys(cursor, 7, tz);
    const t = dailyTotals(app.db, keys, tz).reduce((s, x) => s + x.focusedMs, 0);
    weeks.unshift({ key: cursor, total: t });
    cursor = addDays(cursor, -7, tz);
  }
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const delta = weekOverWeekDeltaMs(weeks[3]!.total, weeks[2]!.total);
  const chart = h("div", { class: "bar-chart" },
    ...weeks.map((w) =>
      h("div", { class: "bar-row" },
        h("span", { class: "muted" }, w.key),
        h("div", null, h("div", { class: "bar", style: `width:${(w.total / max) * 100}%` })),
        h("span", { class: "num" }, formatHM(w.total)),
      )),
  );
  return section("Week over week", chart,
    h("p", { class: "muted num" }, `Change vs previous week: ${delta >= 0 ? "+" : "−"}${formatHM(Math.abs(delta))}`));
}

function breakdownSections(ui: UiContext, dayKeys: string[], tz: (w: number) => number): HTMLElement {
  const { app } = ui;
  const wrap = h("div", { class: "grid-2" });

  const projects = totalsByProject(app.db, dayKeys, tz);
  const maxProject = Math.max(1, ...projects.map((p) => p.focusedMs));
  const projectChart = h("div", { class: "bar-chart" },
    ...(projects.length === 0 ? [emptyNote()] : projects.map((p) =>
      h("div", { class: "bar-row" },
        h("span", null, h("span", { class: "legend-dot", style: `background:${app.colorOf(p.id)}` }), app.projectName(p.id)),
        h("div", null, h("div", { class: "bar", style: `width:${(p.focusedMs / maxProject) * 100}%;background:${app.colorOf(p.id)}` })),
        h("span", { class: "num" }, formatHM(p.focusedMs)),
      ))));
  wrap.append(section("Projects", projectChart));

  const tags = totalsByTag(app.db, dayKeys, tz);
  const tagTable = h("table", { class: "data" },
    h("thead", null, h("tr", null, h("th", null, "Tag"), h("th", { class: "n" }, "Focused"), h("th", { class: "n" }, "Billable"))),
    h("tbody", null,
      ...(tags.length === 0
        ? [h("tr", null, h("td", { colspan: "3" }, emptyNote()))]
        : tags.map((t) => {
            const name = app.db.tags.find((x) => x.id === t.id)?.name ?? t.id;
            return h("tr", null,
              h("td", null, name),
              h("td", { class: "n" }, formatHM(t.focusedMs)),
              h("td", { class: "n" }, formatHM(t.billableFocusedMs)));
          }))));
  wrap.append(section("Tags", tagTable));
  return wrap;
}

function pomodoroSection(ui: UiContext, dayKeys: string[], tz: (w: number) => number): HTMLElement {
  const { app } = ui;
  const comp = pomodoroCompletion(app.db, dayKeys, tz);
  return section("Pomodoro outcomes",
    h("table", { class: "data" },
      h("tbody", null,
        row("Completed work intervals", String(comp.completed)),
        row("Abandoned work intervals", String(comp.abandoned)),
        row("Completion rate", comp.rate === null ? "—" : `${Math.round(comp.rate * 100)}%`),
      )));
}

function goalsSection(ui: UiContext, tz: (w: number) => number): HTMLElement {
  const { app } = ui;
  const goals = goalProgress(app.db, app.now(), tz);
  if (goals.length === 0) {
    return section("Goals", emptyNote("No goals set. Add a target on a project in the Projects view."));
  }
  const rows = goals.map((g) => {
    const pct = Math.min(100, Math.round(g.fraction * 100));
    return h("div", { class: "goal-row" },
      h("div", { class: "row spread" },
        h("span", null, app.projectName(g.projectId), h("span", { class: "faint" }, g.period === "day" ? " · daily" : " · weekly")),
        h("span", { class: "num" },
          `${formatHM(g.focusedMs)} of ${formatHM(g.targetMs)} (${pct}%)${g.behind ? " · behind pace" : ""}`)),
      h("div", { class: "goal-track", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 },
        h("div", { class: "goal-fill", style: `width:${pct}%` })),
    );
  });
  return section("Goals", h("div", null, ...rows));
}

function row(label: string, value: string): Node {
  return h("tr", null, h("td", null, label), h("td", { class: "n" }, value));
}

function section(title: string, body: Node, note?: Node): HTMLElement {
  return h("section", null, h("h2", null, title), body, note ?? null);
}

function emptyNote(text = "No entries in this range yet."): HTMLElement {
  return h("div", { class: "empty-note" }, text);
}
