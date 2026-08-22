import { h, clear } from "./dom.js";
import type { UiContext } from "./main.js";
import type { Entry } from "../data/schema.js";
import { addManualEntry, editEntry, ValidationError } from "../data/model.js";
import type { SessionRef } from "../core/session.js";
import { makeRef } from "./views/timer.js";

export function uiCtx(): UiContext {
  return {
    app: (window as unknown as { __tempotrackApp: UiContext["app"] }).__tempotrackApp,
    main: document.getElementById("main")!,
    nav: document.getElementById("app-nav")!,
    indicator: document.getElementById("running-indicator")!,
    bannerSlot: document.getElementById("banner-slot")!,
    modal: document.getElementById("modal") as HTMLDialogElement,
  };
}

export function openEntryDialog(
  ui: UiContext,
  entry: Entry | null,
  prefill?: { startedWall: number; durationMs: number },
): void {
  const { app, modal } = ui;
  clear(modal);
  const projects = app.db.projects.filter((p) => !p.archived);
  if (projects.length === 0) {
    modal.append(h("p", null, "Create a project first (Projects view)."));
    modal.showModal();
    return;
  }

  const isEdit = entry !== null;
  const startWall = entry?.startedWall ?? prefill?.startedWall ?? floorMinute(app.now() - 3_600_000);
  const durationMin = Math.round((entry?.durationMs ?? prefill?.durationMs ?? 3_600_000) / 60_000);

  const dateInput = h("input", { type: "date", value: toDateInput(startWall) }) as HTMLInputElement;
  const timeInput = h("input", { type: "time", value: toTimeInput(startWall) }) as HTMLInputElement;
  const durInput = h("input", { type: "text", inputmode: "numeric", value: fmtDuration(durationMin), "aria-label": "Duration in hours and minutes" }) as HTMLInputElement;

  const projectSelect = document.createElement("select");
  for (const p of projects) projectSelect.append(new Option(p.name, p.id));
  projectSelect.value = entry?.projectId ?? projects[0]!.id;

  const taskSelect = document.createElement("select");
  const tagBox = h("fieldset", null, h("legend", null, "Tags"));
  fillTasks(app, taskSelect, projectSelect.value);
  projectSelect.addEventListener("change", () => fillTasks(app, taskSelect, projectSelect.value));
  refreshTags(app, tagBox, new Set(entry?.tagIds ?? []));

  const billableCheck = h("input", { type: "checkbox" }) as HTMLInputElement;
  billableCheck.checked =
    entry?.billable ?? app.db.projects.find((p) => p.id === projectSelect.value)?.billableByDefault ?? false;
  projectSelect.addEventListener("change", () => {
    billableCheck.checked = app.db.projects.find((p) => p.id === projectSelect.value)?.billableByDefault ?? false;
  });

  const noteInput = h("input", { type: "text", value: entry?.note ?? "", placeholder: "Optional note" }) as HTMLInputElement;
  const errorLine = h("p", { class: "banner error", role: "alert", style: "display:none;margin:0 0 var(--space-3)" });

  const historySection: Node[] = [];
  if (entry && entry.revisions.length > 0) {
    const list = h("ul", null);
    for (const rev of [...entry.revisions].reverse()) {
      const fields = Object.entries(rev.fields)
        .map(([k, v]) => `${k}: ${String(v[0])} -> ${String(v[1])}`)
        .join("; ");
      list.append(h("li", null, `${new Date(rev.atWall).toLocaleString()} (${rev.source}) — ${fields}`));
    }
    historySection.push(h("h2", null, "Audit trail"), list);
  }

  const form = h("form", {
    onsubmit: (ev: Event) => {
      ev.preventDefault();
      try {
        const startedWall = fromInputs(dateInput.value, timeInput.value);
        const durationMs = parseDur(durInput.value);
        const tagIds = collectTags(tagBox);
        if (isEdit && entry) {
          editEntry(app.db, entry.id, {
            projectId: projectSelect.value,
            taskId: taskSelect.value || null,
            tagIds,
            billable: billableCheck.checked,
            startedWall,
            durationMs,
            note: noteInput.value,
          }, app.now(), "user");
        } else {
          addManualEntry(app.db, {
            projectId: projectSelect.value,
            taskId: taskSelect.value || null,
            tagIds,
            billable: billableCheck.checked,
            startedWall,
            durationMs,
            note: noteInput.value,
          }, app.now());
        }
        app.saveSoon();
        modal.close();
        app.emit();
      } catch (err) {
        const msg = err instanceof ValidationError ? err.message : String((err as Error).message ?? err);
        errorLine.textContent = msg;
        (errorLine as HTMLElement).style.display = "block";
      }
    },
  },
    errorLine,
    fieldRow(h("label", null, "Date"), dateInput),
    fieldRow(h("label", null, "Start"), timeInput),
    fieldRow(h("label", null, "Duration (h:mm)"), durInput),
    fieldRow(h("label", null, "Project"), projectSelect),
    fieldRow(h("label", null, "Task"), taskSelect),
    fieldRow(null, tagBox),
    fieldRow(null, h("span", { class: "row" }, billableCheck, h("span", null, "Billable"))),
    fieldRow(h("label", null, "Note"), noteInput),
    h("div", { class: "row", style: "margin-top: var(--space-4)" },
      h("button", { type: "submit", class: "primary" }, isEdit ? "Save changes" : "Add entry"),
      h("button", { type: "button", onclick: () => modal.close() }, "Cancel"),
    ),
    ...historySection,
  );
  modal.append(form);
  modal.showModal();
}

function fieldRow(label: Node | null, control: Node): HTMLElement {
  return h("div", { style: "margin-bottom: var(--space-3)" }, label, control);
}

function fillTasks(app: UiContext["app"], select: HTMLSelectElement, projectId: string): void {
  while (select.firstChild) select.removeChild(select.firstChild);
  select.append(new Option("(no task)", ""));
  for (const t of app.db.tasks.filter((t) => t.projectId === projectId && !t.done)) {
    select.append(new Option(t.name, t.id));
  }
}

function refreshTags(app: UiContext["app"], box: HTMLElement, selected: Set<string>): void {
  clear(box as HTMLElement);
  box.append(h("legend", null, "Tags"));
  for (const tag of app.db.tags) {
    const cb = h("input", { type: "checkbox", "data-tag": tag.id }) as HTMLInputElement;
    cb.checked = selected.has(tag.id);
    box.append(h("span", { class: "row", style: "margin-right:12px" }, cb, h("span", null, tag.name)));
  }
}

function collectTags(box: HTMLElement): string[] {
  return [...box.querySelectorAll<HTMLInputElement>("input[data-tag]")].filter((c) => c.checked).map((c) => c.dataset.tag!);
}

function floorMinute(wall: number): number {
  return Math.floor(wall / 60_000) * 60_000;
}

function toDateInput(wall: number): string {
  const d = new Date(wall);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toTimeInput(wall: number): string {
  const d = new Date(wall);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fromInputs(dateValue: string, timeValue: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) throw new ValidationError("Pick a date.");
  const wall = new Date(`${dateValue}T${timeValue || "00:00"}:00`).getTime();
  if (!Number.isFinite(wall)) throw new ValidationError("The start time could not be read. Use the pickers or type hh:mm.");
  return wall;
}

function fmtDuration(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

function parseDur(input: string): number {
  const m = /^(\d+)\s*[:.,h]\s*(\d{1,2})?$/.exec(input.trim());
  if (!m) throw new ValidationError(`Use h:mm for the duration, like 1:30 — got "${input}".`);
  const minutes = Number(m[2] ?? 0);
  if (minutes >= 60) throw new ValidationError("Minutes must be below 60 in the duration.");
  return Number(m[1]) * 3_600_000 + minutes * 60_000;
}

export function confirmDialog(ui: UiContext, text: string, action: () => void): void {
  const { modal } = ui;
  clear(modal);
  modal.append(
    h("p", null, text),
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: () => { action(); modal.close(); ui.app.emit(); } }, "Confirm"),
      h("button", { onclick: () => modal.close() }, "Cancel"),
    ),
  );
  modal.showModal();
}

export function openQuickSwitcher(ui: UiContext, switchOnly = false): void {
  const { app, modal } = ui;
  clear(modal);
  const input = h("input", { type: "text", placeholder: "Type to filter projects and tasks…", "aria-label": "Search projects and tasks" }) as HTMLInputElement;
  const results = h("ul", { role: "listbox", style: "list-style:none;padding:0;margin:var(--space-3) 0 0" });
  const pairs = app.recentPairs(50);
  interface Candidate { label: string; projectId: string; taskId: string | null }
  const candidates: Candidate[] = [];
  for (const p of app.db.projects.filter((p) => !p.archived)) {
    candidates.push({ label: p.name, projectId: p.id, taskId: null });
    for (const t of app.db.tasks.filter((t) => t.projectId === p.id && !t.done)) {
      candidates.push({ label: `${p.name} · ${t.name}`, projectId: p.id, taskId: t.id });
    }
  }

  function renderResults(filterText: string): void {
    clear(results);
    const q = filterText.trim().toLowerCase();
    const matches = candidates
      .filter((c) => c.label.toLowerCase().includes(q))
      .sort((a, b) => rank(a, q) - rank(b, q))
      .slice(0, 9);
    matches.forEach((c, i) => {
      const btn = h("button", { style: "width:100%;text-align:left;margin-bottom:4px" },
        `${i + 1}. ${c.label}`);
      btn.addEventListener("click", () => choose(c));
      results.append(h("li", null, btn));
    });
    if (matches.length === 0) results.append(h("li", { class: "muted" }, "No match."));
  }

  function rank(c: Candidate, q: string): number {
    const recentIdx = pairs.findIndex((p) => p.projectId === c.projectId && p.taskId === c.taskId);
    const startsWith = c.label.toLowerCase().startsWith(q) ? -10 : 0;
    return recentIdx + startsWith;
  }

  function choose(c: Candidate): void {
    const ref: SessionRef = makeRef(app, c.projectId, c.taskId);
    const snap = app.engine.snapshot();
    if (snap.status === "running" || snap.status === "paused" || snap.status === "awaiting") {
      app.engine.setRef(ref);
    } else {
      app.start(ref, app.pendingMode, app.pendingMode === "countdown" ? (app.pendingCountdownMin ?? 25) * 60_000 : undefined);
    }
    app.saveNow();
    modal.close();
    app.emit();
  }

  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key >= "1" && ev.key <= "9") {
      ev.preventDefault();
      const idx = Number(ev.key) - 1;
      const buttons = results.querySelectorAll("button");
      if (idx < buttons.length) (buttons[idx] as HTMLButtonElement).click();
    }
  });

  modal.append(
    input,
    results,
    h("div", { class: "row" }, h("button", { onclick: () => modal.close(), class: "subtle" }, "Esc to close")),
  );
  modal.showModal();
  renderResults("");
  input.focus();
}

export function openHelp(ui: UiContext): void {
  const { modal } = ui;
  clear(modal);
  const rows: [string, string][] = [
    ["Space", "Start / pause the timer"],
    ["S", "Stop the timer"],
    ["K", "Skip pomodoro phase"],
    ["N", "Add past time"],
    ["T", "Quick project switcher"],
    ["← / →", "Previous / next day"],
    ["1–5", "Jump to section"],
    ["?", "This help"],
    ["Esc", "Close dialogs"],
  ];
  modal.append(
    h("h2", null, "Keyboard"),
    h("div", { class: "shortcut-grid" },
      ...rows.flatMap(([k, d]) => [h("span", { class: "kbd" }, k), h("span", null, d)]),
    ),
    h("div", { class: "row", style: "margin-top: var(--space-4)" },
      h("button", { class: "primary", onclick: () => modal.close() }, "Close")),
  );
  modal.showModal();
}
