import { App, clockText } from "./app.js";
import { renderHeader, renderIndicator } from "./views/header.js";
import { renderToday } from "./views/today.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderReports } from "./views/reports.js";
import { renderProjects } from "./views/projects.js";
import { renderSettings } from "./views/settings.js";
import { installKeyboard, wireActivityListeners } from "./keyboard.js";
import { h } from "./dom.js";

const app = new App();
(window as unknown as { __tempotrackApp: App }).__tempotrackApp = app;

const main = document.getElementById("main")!;
const nav = document.getElementById("app-nav")!;
const indicator = document.getElementById("running-indicator")!;
const bannerSlot = document.getElementById("banner-slot")!;
const modal = document.getElementById("modal") as HTMLDialogElement;

export interface UiContext {
  app: App;
  main: HTMLElement;
  nav: HTMLElement;
  indicator: HTMLElement;
  bannerSlot: HTMLElement;
  modal: HTMLDialogElement;
}

export const ui: UiContext = { app, main, nav, indicator, bannerSlot, modal };

export const ROUTES: Record<string, () => void> = {
  today: () => renderToday(ui),
  analytics: () => renderAnalytics(ui),
  reports: () => renderReports(ui),
  projects: () => renderProjects(ui),
  settings: () => renderSettings(ui),
};

export function navigate(route: string): void {
  if (routeFromHash() === route) render();
  else location.hash = `#${route}`;
}

function routeFromHash(): string {
  const key = location.hash.replace(/^#/, "") || "today";
  return ROUTES[key] ? key : "today";
}

export function render(): void {
  app.route = routeFromHash();
  renderHeader(ui);
  if (app.banner) {
    const close = h("button", { class: "subtle", onclick: () => { app.banner = null; render(); } }, "Dismiss");
    const b = h("div", { class: `banner${app.bannerIsError ? " error" : ""}`, role: "status" },
      h("span", null, app.banner), close);
    bannerSlot.replaceChildren(b);
  } else {
    bannerSlot.replaceChildren();
  }
  while (main.firstChild) main.removeChild(main.firstChild);
  (ROUTES[app.route] ?? ROUTES.today!)();
}

window.addEventListener("hashchange", render);
app.onChange(render);
app.onTick(() => patchTick());

function patchTick(): void {
  const display = document.getElementById("timer-display");
  if (display) {
    const st = app.engine.publicState();
    const snap = app.engine.snapshot();
    const showRemaining = snap.mode !== "stopwatch" && snap.phaseTargetMs !== null && st.status !== "idle";
    display.textContent = clockText(showRemaining ? st.remainingMs : st.elapsedMs);
    const fill = display.parentElement?.querySelector<HTMLElement>(".progress-fill");
    if (fill && st.progress01 !== null) fill.style.width = `${(st.progress01 * 100).toFixed(2)}%`;
  }
  updateIndicatorOnly();
}

function updateIndicatorOnly(): void {
  renderIndicator({ indicator, app } as unknown as Parameters<typeof renderIndicator>[0]);
}

installKeyboard(app, modal, render, navigate);
wireActivityListeners(app);

setInterval(() => app.tick(), 250);

window.addEventListener("beforeunload", () => {
  app.db.engineSnapshot = app.engine.snapshot();
  app.saveNow();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    app.idle.noteActivity("visibility");
    app.tick();
    app.saveNow();
  } else {
    app.db.engineSnapshot = app.engine.snapshot();
    app.saveNow();
  }
});

render();
