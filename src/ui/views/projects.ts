import { h, clear, projectColor } from "../dom.js";
import type { UiContext } from "../main.js";
import { createTask, createTag, deleteTag, renameTag, updateProject, ValidationError, uid } from "../../data/model.js";

export function renderProjects(ui: UiContext): void {
  const { app, main } = ui;

  main.append(h("h1", null, "Projects"));

  // New project form
  const nameInput = h("input", { type: "text", "aria-label": "New project name", placeholder: "New project name" }) as HTMLInputElement;
  let colorIndex = nextColor(app);
  const swatches = swatchRow(colorIndex, (i) => { colorIndex = i; });
  const billableCheck = h("input", { type: "checkbox" }) as HTMLInputElement;
  const rateInput = h("input", { type: "text", inputmode: "decimal", placeholder: "e.g. 90.00", "aria-label": "Hourly rate" }) as HTMLInputElement;
  const goalInput = h("input", { type: "number", min: "0", step: "0.5", style: "width:80px", "aria-label": "Goal target hours per week" }) as HTMLInputElement;
  const errorLine = h("p", { class: "banner error", role: "alert", style: "display:none;margin:0 0 var(--space-3)" });

  main.append(
    h("form", {
      class: "card",
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        try {
          const rate = parseRate(rateInput.value);
          app.createProject(nameInput.value.trim(), {
            colorIndex,
            billableByDefault: billableCheck.checked,
            rateMinorPerHour: rate,
            goalTargetMs: goalInput.value ? Math.round(Number(goalInput.value) * 3_600_000) : null,
            goalPeriod: goalInput.value ? ("week" as const) : null,
          });
          nameInput.value = "";
          rateInput.value = "";
          goalInput.value = "";
          errorLine.style.display = "none";
        } catch (err) {
          errorLine.textContent = err instanceof ValidationError ? err.message : String((err as Error).message);
          errorLine.style.display = "block";
        }
      },
    },
      errorLine,
      h("div", { class: "row" },
        nameInput,
        h("span", { class: "row" }, billableCheck, h("span", null, "Billable by default")),
        h("span", null, h("label", null, "Hourly rate"), rateInput),
        h("span", null, h("label", null, "Weekly goal (h)"), goalInput),
        h("button", { type: "submit", class: "primary" }, "Add project"),
      ),
      h("div", { style: "margin-top: var(--space-3)" }, swatches),
    ),
  );

  for (const project of app.db.projects.filter((p) => !p.archived)) {
    main.append(projectRow(ui, project.id, () => renderProjects(ui)));
  }

  const archived = app.db.projects.filter((p) => p.archived);
  if (archived.length > 0) {
    main.append(
      h("h2", null, "Archived"),
      ...archived.map((p) =>
        h("div", { class: "project-row" },
          h("span", { class: "legend-dot", style: `background:${projectColor(p.colorIndex)}` }),
          h("span", { class: "muted grow" }, p.name),
          h("button", {
            onclick: () => {
              updateProject(app.db, p.id, { archived: false }, app.now());
              app.saveSoon();
              app.emit();
            },
          }, "Restore")),
      ),
    );
  }

  main.append(tagManager(ui));
}

function nextColor(app: UiContext["app"]): number {
  return app.db.projects.length % 8;
}

function swatchRow(selected: number, onPick: (i: number) => void): HTMLElement {
  return h("div", { class: "swatches", role: "group", "aria-label": "Project colour" },
    ...Array.from({ length: 8 }, (_, i) =>
      h("button", {
        class: "swatch",
        style: `background:${projectColor(i)}`,
        "aria-pressed": String(i === selected),
        "aria-label": `Colour ${i + 1}`,
        onclick: (ev: Event) => {
          onPick(i);
          const row = (ev.target as HTMLElement).parentElement!;
          for (const b of row.querySelectorAll("button")) b.setAttribute("aria-pressed", "false");
          (ev.target as HTMLElement).setAttribute("aria-pressed", "true");
        },
      })),
  );
}

function projectRow(ui: UiContext, projectId: string, rerender: () => void): HTMLElement {
  const { app } = ui;
  const p = app.db.projects.find((x) => x.id === projectId)!;
  const tasks = app.db.tasks.filter((t) => t.projectId === projectId);

  const editBtn = h("button", { class: "subtle" }, "Edit");
  editBtn.addEventListener("click", () => openProjectEditor(ui, projectId, rerender));

  const archiveBtn = h("button", { class: "subtle danger" }, "Archive");
  archiveBtn.addEventListener("click", () => {
    updateProject(app.db, projectId, { archived: true }, app.now());
    app.saveSoon();
    app.emit();
  });

  const taskList = h("div");
  for (const t of tasks) {
    const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = t.done;
    cb.setAttribute("aria-label", `Mark ${t.name} done`);
    cb.addEventListener("change", () => {
      t.done = cb.checked;
      app.saveSoon();
      app.emit();
    });
    taskList.append(h("div", { class: "row", style: "padding-left:24px" }, cb, h("span", { class: t.done ? "faint" : "" }, t.name)));
  }
  const newTaskInput = h("input", { type: "text", placeholder: "Add task…", "aria-label": `New task in ${p.name}` }) as HTMLInputElement;
  newTaskInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    try {
      createTask(app.db, projectId, newTaskInput.value, app.now());
      newTaskInput.value = "";
      app.saveSoon();
      app.emit();
    } catch (err) {
      app.showError(String((err as Error).message));
    }
  });
  if (!p.archived) taskList.append(newTaskInput);

  return h("div", { class: "card", style: "margin-bottom: var(--space-4)" },
    h("div", { class: "project-row" },
      h("span", { class: "legend-dot", style: `background:${projectColor(p.colorIndex)}`, "aria-hidden": "true" }),
      h("strong", { class: "grow" }, p.name),
      h("span", { class: "muted num" },
        `${app.entriesOfProject(projectId).length} entries`,
        p.rateMinorPerHour !== null ? ` · ${(p.rateMinorPerHour / 100).toFixed(2)} ${app.db.settings.currencyCode}/h` : "",
        p.goalTargetMs !== null ? ` · goal ${Math.round(p.goalTargetMs / 3_600_000)}h/${p.goalPeriod}` : ""),
      editBtn,
      archiveBtn,
    ),
    taskList,
  );
}

function openProjectEditor(ui: UiContext, projectId: string, rerender: () => void): void {
  const { app, modal } = ui;
  const p = app.db.projects.find((x) => x.id === projectId)!;
  clear(modal);

  const nameInput = h("input", { type: "text", value: p.name, "aria-label": "Project name" }) as HTMLInputElement;
  let colorIndex = p.colorIndex;
  const swatches = swatchRow(colorIndex, (i) => { colorIndex = i; });
  const billableCheck = h("input", { type: "checkbox" }) as HTMLInputElement;
  billableCheck.checked = p.billableByDefault;
  const rateInput = h("input", {
    type: "text", inputmode: "decimal",
    value: p.rateMinorPerHour === null ? "" : (p.rateMinorPerHour / 100).toFixed(2),
    "aria-label": "Hourly rate",
  }) as HTMLInputElement;
  const parentSelect = document.createElement("select");
  parentSelect.append(new Option("(top level)", ""));
  for (const other of app.db.projects.filter((x) => !x.archived && x.id !== projectId)) {
    parentSelect.append(new Option(other.name, other.id));
  }
  parentSelect.value = p.parentId ?? "";

  modal.append(
    h("form", {
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        try {
          updateProject(app.db, projectId, {
            name: nameInput.value.trim(),
            colorIndex,
            billableByDefault: billableCheck.checked,
            rateMinorPerHour: parseRate(rateInput.value),
            parentId: parentSelect.value || null,
          }, app.now());
          app.saveSoon();
          modal.close();
          app.emit();
          rerender();
        } catch (err) {
          app.showError(err instanceof ValidationError ? err.message : String((err as Error).message));
        }
      },
    },
      fieldRow(h("label", null, "Name"), nameInput),
      fieldRow(null, swatches),
      fieldRow(null, h("span", { class: "row" }, billableCheck, h("span", null, "Billable by default"))),
      fieldRow(h("label", null, "Hourly rate (leave empty for none)"), rateInput),
      fieldRow(h("label", null, "Parent project"), parentSelect),
      h("div", { class: "row" },
        h("button", { type: "submit", class: "primary" }, "Save"),
        h("button", { type: "button", onclick: () => modal.close() }, "Cancel")),
    ),
  );
  modal.showModal();
}

function parseRate(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) {
    throw new ValidationError(`Hourly rate should look like 90 or 90.00 — got "${trimmed}".`);
  }
  const [whole, frac = ""] = trimmed.replace(",", ".").split(".");
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return minor;
}

function tagManager(ui: UiContext): HTMLElement {
  const { app } = ui;
  const wrap = h("section");
  wrap.append(h("h2", null, "Tags"));
  const list = h("div");
  for (const tag of app.db.tags) {
    const input = h("input", { type: "text", value: tag.name, "aria-label": `Rename tag ${tag.name}` }) as HTMLInputElement;
    input.addEventListener("change", () => {
      try {
        renameTag(app.db, tag.id, input.value, app.now());
        app.saveSoon();
        app.emit();
      } catch (err) {
        app.showError(err instanceof ValidationError ? err.message : String((err as Error).message));
        input.value = tag.name;
      }
    });
    list.append(h("div", { class: "row", style: "margin-bottom:6px" },
      input,
      h("button", {
        class: "subtle danger",
        onclick: () => {
          deleteTag(app.db, tag.id, app.now());
          app.saveSoon();
          app.emit();
        },
      }, "Delete"),
    ));
  }
  const addInput = h("input", { type: "text", placeholder: "Add tag…" }) as HTMLInputElement;
  addInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    try {
      createTag(app.db, addInput.value);
      addInput.value = "";
      app.saveSoon();
      app.emit();
    } catch (err) {
      app.showError(err instanceof ValidationError ? err.message : String((err as Error).message));
    }
  });
  wrap.append(list, addInput);
  return wrap;
}

function fieldRow(label: Node | null, control: Node): HTMLElement {
  return h("div", { style: "margin-bottom: var(--space-3)" }, label, control);
}
