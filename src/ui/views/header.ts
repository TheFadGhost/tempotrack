import { h } from "../dom.js";
import { clockText } from "../app.js";
import type { UiContext } from "../main.js";
import { navigate } from "../main.js";

const NAV = [
  ["today", "Today"],
  ["analytics", "Analytics"],
  ["reports", "Reports"],
  ["projects", "Projects"],
  ["settings", "Settings"],
] as const;

export function renderHeader(ui: UiContext): void {
  const { app, nav, indicator } = ui;
  nav.replaceChildren(
    ...NAV.map(([route, label]) =>
      h("a", { href: `#${route}`, "aria-current": app.route === route ? "page" : false }, label),
    ),
  );

  const st = app.engine.publicState();
  const cls =
    st.status === "running" && app.mode === "pomodoro" && st.phase !== "work"
      ? "break"
      : st.status === "running"
        ? "running"
        : st.status === "paused" || st.status === "awaiting"
          ? "paused"
          : "";
  indicator.className = cls;
  indicator.removeAttribute("aria-hidden");
  if (st.status === "running") {
    const project = app.projectName(st.ref?.projectId ?? "");
    const phaseWord = cls === "break" ? "On break" : "Running";
    indicator.replaceChildren(
      h("span", { class: "dot", "aria-hidden": "true" }),
      h("span", null, `${phaseWord} · ${project}`),
      h("span", { class: "num" }, clockText(cls === "break" || app.mode !== "stopwatch" ? st.remainingMs : st.elapsedMs)),
    );
  } else if (st.status === "paused" || st.status === "awaiting") {
    indicator.replaceChildren(
      h("span", { class: "dot", "aria-hidden": "true" }),
      h("span", null, "Paused"),
      h("span", { class: "num" }, clockText(st.elapsedMs)),
    );
  } else {
    indicator.replaceChildren(h("span", { class: "dot", "aria-hidden": "true" }), h("span", null, "Not running"));
  }

  void navigate;
}
