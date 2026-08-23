import { h } from "../dom.js";
import type { UiContext } from "../main.js";
import { renderTimerCard } from "./timer.js";
import { dayDetail } from "./daydetail.js";
import { formatHM } from "../../core/duration.js";
import { coveredUnionMs } from "../../analytics/aggregate.js";

export function renderToday(ui: UiContext): void {
  const { app, main } = ui;
  const dayKey = app.selectedDayKey;
  const total = app.totalForDay(dayKey);

  main.append(
    h("div", { class: "row spread" },
      h("h1", null, "Today"),
      h("div", { class: "row" },
        h("button", { class: "subtle", "aria-label": "Previous day", onclick: () => shiftDay(app, -1) }, "‹"),
        h("strong", { class: "num" }, dayKey),
        h("button", { class: "subtle", "aria-label": "Next day", onclick: () => shiftDay(app, +1) }, "›"),
        h("button", { class: "subtle", onclick: () => { app.selectedDayKey = app.dayKeyOf(app.now()); app.emit(); } }, "Today"),
      ),
    ),
    h("div", { class: "row" },
      h("span", { class: "muted" }, "Focused"),
      h("span", { class: "big-total num" }, formatHM(total)),
    ),
    ...(() => {
      const dayStart = app.startDayWall(dayKey);
      const entries = app.db.entries.filter((e) => e.startedWall >= dayStart && e.startedWall < dayStart + 86_400_000);
      const gross = entries.reduce((s, e) => s + e.durationMs, 0);
      const net = coveredUnionMs(entries);
      return net < gross
        ? [h("p", { class: "muted num", style: "margin-top:-8px" }, `Contains overlapping entries · net covered time ${formatHM(net)} of ${formatHM(gross)}`)]
        : [];
    })(),
    ...(() => { const onb = onboardingIfNeeded(ui); return onb ? [onb] : []; })(),
    renderTimerCard(ui),
    dayDetail(ui, app.startDayWall(dayKey)),
  );
}

function shiftDay(app: UiContext["app"], delta: number): void {
  app.selectedDayKey = app.dayKeyOf(app.startDayWall(app.selectedDayKey) + delta * 86_400_000);
  app.emit();
}

function onboardingIfNeeded(ui: UiContext): Node | null {
  const { app } = ui;
  if (app.db.settings.onboarded || app.db.projects.length > 0) return null;
  const nameInput = h("input", { type: "text", id: "onb-name", placeholder: "e.g. Sample client" }) as HTMLInputElement;
  return h("div", { class: "card", role: "region", "aria-label": "Welcome" },
    h("h2", null, "Welcome to Tempotrack"),
    h("p", { class: "muted" },
      "Timers keep counting through sleep and clock changes by design: if the machine is away while a timer runs, you will be asked what to do with that time — nothing is counted silently. Time stays in this browser; export it any time from Settings."),
    h("form", {
      class: "row",
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        try {
          app.createProject(nameInput.value.trim() || "Sample project", {});
          app.db.settings.onboarded = true;
          app.saveNow();
          app.emit();
        } catch (err) {
          app.showError(String((err as Error).message));
        }
      },
    },
      h("span", null, h("label", { for: "onb-name" }, "First project")),
      nameInput,
      h("button", { type: "submit", class: "primary" }, "Create and start"),
    ),
  );
}
