import { h } from "../dom.js";
import { clockText } from "../app.js";
import type { UiContext } from "../main.js";
import { openEntryDialog, openQuickSwitcher } from "../dialogs.js";
import { formatHM } from "../../core/duration.js";

export function renderTimerCard(ui: UiContext): HTMLElement {
  const { app } = ui;
  const st = app.engine.publicState();
  const snap = app.engine.snapshot();

  const isBreak = snap.mode === "pomodoro" && (st.phase === "shortBreak" || st.phase === "longBreak");
  const card = h("div", {
    id: "timer-card",
    class: `card${isBreak ? " on-break" : ""}${st.status === "running" && !isBreak ? " running-focus" : ""}`,
  });

  const modeTabs = h("div", { class: "mode-tabs", role: "group", "aria-label": "Timer mode" },
    ...(["pomodoro", "stopwatch", "countdown"] as const).map((m) =>
      h("button", {
        "aria-pressed": String(snap.mode === m),
        onclick: () => {
          app.pendingMode = m;
          ui.app.emit();
        },
      }, m === "pomodoro" ? "Pomodoro" : m === "stopwatch" ? "Stopwatch" : "Countdown"),
    ),
  );

  const stateWord =
    st.status === "needsReconciliation" ? "AWAY TIME DETECTED"
    : isBreak && st.status === "running" ? "ON BREAK"
    : st.status === "running" ? "RUNNING"
    : st.status === "paused" ? "PAUSED"
    : st.status === "awaiting" ? `READY: ${labelPhase(st.phase)}`.toUpperCase()
    : st.status === "idle" ? "READY"
    : "";

  const chip = h("div", { class: `timer-state-chip ${clsOf(st.status, isBreak)}` },
    h("span", { class: "dot", "aria-hidden": "true" }),
    h("span", null, stateWord),
  );

  const showRemaining = snap.mode !== "stopwatch" && (snap.phaseTargetMs !== null);
  const display = clockText(showRemaining && st.status !== "idle" ? st.remainingMs : st.elapsedMs);

  const progress = (() => {
    if (!showRemaining || st.progress01 === null || st.status === "idle") return null;
    return h("div", { class: "progress-track", role: "progressbar", "aria-hidden": "true" },
      h("div", { class: `progress-fill${snap.mode !== "stopwatch" ? " depleting" : ""}`, style: `width:${(st.progress01 * 100).toFixed(2)}%` }));
  })();

  const refLine = st.ref
    ? `${app.projectName(st.ref.projectId)}${st.ref.taskId ? " · " + (app.db.tasks.find(t => t.id === st.ref!.taskId)?.name ?? "") : ""}`
    : "Pick a project to start";

  const controls = h("div", { class: "timer-controls" });
  if (st.status === "idle" || st.status === "awaiting") {
    if (snap.mode === "countdown" && st.status === "idle") {
      controls.append(countdownPicker(app));
    }
    controls.append(
      h("button", { class: "primary", onclick: () => startOrResume(ui) }, st.status === "awaiting" ? `Start ${labelPhase(st.phase)}` : "Start"),
      h("button", { onclick: () => openQuickSwitcher(ui) }, "Choose project…"),
      h("button", { onclick: () => openEntryDialog(ui, null) }, "Add past time"),
    );
    if (st.status === "awaiting") {
      controls.append(h("button", { class: "subtle", onclick: () => app.stop() }, "Finish session"));
    }
  } else if (st.status === "running") {
    controls.append(
      h("button", { class: "primary", onclick: () => { app.toggle(); } }, "Pause"),
      h("button", { onclick: () => app.stop() }, "Stop"),
    );
    if (snap.mode === "pomodoro") controls.append(h("button", { class: "subtle", onclick: () => app.skip() }, "Skip phase"));
    controls.append(h("button", { class: "subtle", onclick: () => openQuickSwitcher(ui, true) }, "Switch project"));
  } else if (st.status === "paused") {
    controls.append(
      h("button", { class: "primary", onclick: () => app.toggle() }, "Resume"),
      h("button", { onclick: () => app.stop() }, "Stop"),
    );
  }

  card.append(modeTabs, chip, h("div", { id: "timer-display", class: "num", role: "timer", "aria-label": "Timer" }, display));
  if (progress) card.append(progress);
  else card.append(h("div", { class: "progress-track", "aria-hidden": "true" }, h("div", { class: "progress-fill depleting", style: "width:0%" })));
  card.append(h("div", { class: "timer-ref" }, refLine), controls);

  if (st.reconciliation) card.append(reconcilePanel(ui, st));
  else if (app.idlePrompt) card.append(idlePanel(ui));

  if (st.status === "idle" && !st.ref && app.db.entries.length > 0) {
    card.append(h("div", { class: "recent-list" },
      h("span", { class: "faint" }, "Recent:"),
      ...app.recentPairs().map((r) =>
        h("button", { onclick: () => { app.start(makeRef(app, r.projectId, r.taskId), app.pendingMode, app.pendingMode === "countdown" ? (app.pendingCountdownMin ?? 25) * 60_000 : undefined); } }, r.label)),
    ));
  }
  return card;
}

function clsOf(status: string, isBreak: boolean): string {
  if (status === "running") return isBreak ? "break" : "running";
  if (status === "paused" || status === "awaiting") return "paused";
  return "";
}

function labelPhase(phase: string | null): string {
  return phase === "shortBreak" ? "short break" : phase === "longBreak" ? "long break" : phase === "work" ? "focus" : "";
}

export function makeRef(app: UiContext["app"], projectId: string, taskId: string | null): { projectId: string; taskId: string | null; tagIds: string[]; billable: boolean } {
  const project = app.db.projects.find((p) => p.id === projectId);
  return {
    projectId,
    taskId,
    tagIds: [],
    billable: project?.billableByDefault ?? false,
  };
}

function startOrResume(ui: UiContext): void {
  const { app } = ui;
  const snap = app.engine.snapshot();
  if (snap.status === "awaiting") app.engine.resume();
  else {
    let projectId = snap.ref?.projectId ?? pickFirstProject(app);
    if (!projectId) {
      openQuickSwitcher(ui);
      return;
    }
    const countdownMs = app.pendingMode === "countdown" ? (app.pendingCountdownMin ?? 25) * 60_000 : undefined;
    app.start({ projectId, taskId: snap.ref?.taskId ?? null, tagIds: [], billable: app.db.projects.find(p => p.id === projectId)?.billableByDefault ?? false }, app.pendingMode, countdownMs);
  }
  app.saveNow();
  app.emit();
}

function pickFirstProject(app: UiContext["app"]): string | null {
  return app.db.projects.find((p) => !p.archived)?.id ?? null;
}

function countdownPicker(app: UiContext["app"]): HTMLElement {
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Countdown length in minutes");
  for (const m of [5, 10, 15, 25, 45, 60, 90]) {
    const opt = new Option(`${m} min`, String(m));
    if ((app.pendingCountdownMin ?? 25) === m) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => {
    app.pendingCountdownMin = Number(select.value);
    app.emit();
  });
  return select;
}

function reconcilePanel(ui: UiContext, st: ReturnType<UiContext["app"]["engine"]["publicState"]>): HTMLElement {
  const { app } = ui;
  const rec = st.reconciliation!;
  const from = new Date(rec.gapStartedWallMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const to = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const select = projectSelect(ui);
  return h("div", { class: "resolve-panel", role: "alertdialog", "aria-label": "Away time detected" },
    h("strong", null, `The machine was away from ${from} to ${to}.`),
    h("p", { class: "muted" }, `Trusted focus time so far: ${formatHM(rec.trustedElapsedMs)}. The unaccounted span is ${formatHM(rec.absentMs)}; keeping it would count ${formatHM(rec.keepFullMs)} total.`),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => { app.engine.resolveReconciliation("keepFull"); app.saveNow(); app.emit(); } }, "Keep the whole span"),
      h("button", { onclick: () => { app.engine.resolveReconciliation("discardAbsent"); app.saveNow(); app.emit(); } }, "Discard the away span"),
      h("span", { class: "row" }, select,
        h("button", {
          onclick: () => {
            const pid = (select.value || firstProjectId(app))!;
            app.engine.reassignFromReconciliation({ projectId: pid, taskId: null, tagIds: [], billable: app.db.projects.find(p => p.id === pid)?.billableByDefault ?? false });
            app.saveNow();
            app.emit();
          },
        }, "Log away span to…")),
      h("button", { class: "danger", onclick: () => { app.engine.resolveReconciliation("discardSegment"); app.saveNow(); app.emit(); } }, "End timer at away start"),
    ),
  );
}

function idlePanel(ui: UiContext): HTMLElement {
  const { app } = ui;
  const idle = app.idlePrompt!;
  const select = projectSelect(ui);
  return h("div", { class: "resolve-panel", role: "alertdialog", "aria-label": "Idle time detected" },
    h("strong", null, `No activity for ${formatHM(idle.idleMs)} while the timer ran.`),
    h("p", { class: "muted" }, "Only input inside Tempotrack is observed — nothing about other applications."),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => { app.engine.resolveIdleStretch(idle.idleMs, "keep"); app.idlePrompt = null; app.idle.noteActivity("pointer"); app.emit(); } }, "Keep it"),
      h("button", { onclick: () => { app.engine.resolveIdleStretch(idle.idleMs, "discard"); app.idlePrompt = null; app.idle.noteActivity("pointer"); app.saveSoon(); app.emit(); } }, "Remove it"),
      h("span", { class: "row" }, select,
        h("button", {
          onclick: () => {
            const pid = (select.value || firstProjectId(app))!;
            app.engine.reassignAfterIdle({ projectId: pid, taskId: null, tagIds: [], billable: app.db.projects.find(p => p.id === pid)?.billableByDefault ?? false }, idle.idleMs);
            app.idlePrompt = null;
            app.idle.noteActivity("pointer");
            app.saveSoon();
            app.emit();
          },
        }, "Move it to…")),
      h("button", { class: "danger", onclick: () => { app.engine.resolveIdleStretch(idle.idleMs, "stop"); app.idlePrompt = null; app.stop(); } }, "Stop at idle start"),
    ),
  );
}

function firstProjectId(app: UiContext["app"]): string | null {
  return app.db.projects.find((p) => !p.archived)?.id ?? null;
}

export function projectSelect(ui: UiContext): HTMLSelectElement {
  const { app } = ui;
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Project");
  for (const p of app.db.projects.filter((p) => !p.archived)) {
    select.append(new Option(p.name, p.id));
  }
  return select;
}

