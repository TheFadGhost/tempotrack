import { h } from "../dom.js";
import type { UiContext } from "../main.js";
import type { Settings } from "../../data/schema.js";
import { buildSampleDatabase } from "../../data/sample.js";

export function renderSettings(ui: UiContext): void {
  const { app, main } = ui;
  const s = app.db.settings;

  main.append(h("h1", null, "Settings"));
  main.append(themeSection(ui), timerDefaultsSection(ui), workPatternSection(ui), notificationsSection(ui), dataSection(ui));

  function setSetting(key: keyof Settings, value: unknown): void {
    (s as unknown as Record<string, unknown>)[key as string] = value;
    app.saveSoon();
    app.emit();
  }

  // Theme
  function themeSection(ctx: UiContext): HTMLElement {
    return section("Theme",
      h("div", { class: "row", role: "radiogroup", "aria-label": "Theme" },
        ...(["light", "dark", "dim", "highContrast"] as const).map((t) => {
          const radio = h("input", { type: "radio", name: "theme", value: t }) as HTMLInputElement;
          radio.checked = s.theme === t;
          radio.addEventListener("change", () => {
            s.theme = t;
            document.documentElement.dataset.theme = t;
            ctx.app.saveSoon();
            ctx.app.emit();
          });
          return h("span", { class: "row" }, radio,
            h("span", null, t === "highContrast" ? "High contrast" : t === "dim" ? "Dim (for long focus sessions)" : t[0]!.toUpperCase() + t.slice(1)));
        })),
    );
  }

  // Pomodoro defaults
  function timerDefaultsSection(ctx: UiContext): HTMLElement {
    const num = (label: string, key: "workMin" | "shortBreakMin" | "longBreakMin" | "longBreakEvery", value: number) => {
      const input = h("input", { type: "number", min: "1", max: "180", value: String(value), style: "width:80px" }) as HTMLInputElement;
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (!Number.isInteger(v) || v < 1 || v > 180) {
          ctx.app.showError("Pomodoro lengths must be whole minutes between 1 and 180.");
          input.value = String(value);
          return;
        }
        s.pomodoro[key] = v;
        ctx.app.saveSoon();
      });
      return h("span", null, h("label", null, label), input);
    };
    const autoStart = h("input", { type: "checkbox" }) as HTMLInputElement;
    autoStart.checked = s.pomodoro.autoStartNext;
    autoStart.addEventListener("change", () => {
      s.pomodoro.autoStartNext = autoStart.checked;
      ctx.app.saveSoon();
    });
    return section("Pomodoro defaults",
      h("div", { class: "row" },
        num("Focus (min)", "workMin", s.pomodoro.workMin),
        num("Short break", "shortBreakMin", s.pomodoro.shortBreakMin),
        num("Long break", "longBreakMin", s.pomodoro.longBreakMin),
        num("Long break every N focus intervals", "longBreakEvery", s.pomodoro.longBreakEvery),
        h("span", { class: "row" }, autoStart, h("span", null, "Start next phase automatically")),
      ));
  }

  // Work pattern
  function workPatternSection(ctx: UiContext): HTMLElement {
    const weekMonday = h("input", { type: "radio", name: "weekstart", value: "1" }) as HTMLInputElement;
    const weekSunday = h("input", { type: "radio", name: "weekstart", value: "0" }) as HTMLInputElement;
    weekMonday.checked = s.weekStartsOn === 1;
    weekSunday.checked = s.weekStartsOn === 0;
    weekMonday.addEventListener("change", () => { if (weekMonday.checked) { s.weekStartsOn = 1; save(); } });
    weekSunday.addEventListener("change", () => { if (weekSunday.checked) { s.weekStartsOn = 0; save(); } });

    const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const cb = h("input", { type: "checkbox", value: String(d) }) as HTMLInputElement;
      cb.checked = s.workingDays.includes(d);
      cb.addEventListener("change", () => {
        s.workingDays = [1, 2, 3, 4, 5, 6, 0].filter((x) =>
          x === d ? cb.checked : [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-day]')].find((i) => i.value === String(x))!.checked);
        save();
      });
      cb.setAttribute("data-day", "");
      return h("span", { class: "row" }, cb, h("span", null, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]));
    });

    const startInput = timeInput(s.workdayStartMinute);
    startInput.addEventListener("change", () => { s.workdayStartMinute = toMinutes(startInput); save(); });
    const endInput = timeInput(s.workdayEndMinute);
    endInput.addEventListener("change", () => { s.workdayEndMinute = toMinutes(endInput); save(); });

    const gapInput = h("input", { type: "number", min: "1", max: "240", value: String(s.minReportedGapMs / 60_000), style: "width:80px" }) as HTMLInputElement;
    gapInput.addEventListener("change", () => {
      const v = Number(gapInput.value);
      if (!Number.isInteger(v) || v < 1 || v > 240) { ctx.app.showError("Minimum gap must be 1–240 minutes."); gapInput.value = String(s.minReportedGapMs / 60_000); return; }
      s.minReportedGapMs = v * 60_000; save();
    });

    const idleInput = h("input", { type: "number", min: "1", max: "120", value: String(s.idleThresholdMs / 60_000), style: "width:80px" }) as HTMLInputElement;
    idleInput.addEventListener("change", () => {
      const v = Number(idleInput.value);
      if (!Number.isInteger(v) || v < 1 || v > 120) { ctx.app.showError("Idle threshold must be 1–120 minutes."); idleInput.value = String(s.idleThresholdMs / 60_000); return; }
      s.idleThresholdMs = v * 60_000; save();
    });

    return section("Working pattern",
      h("div", { class: "row" },
        h("span", { class: "row" }, weekMonday, h("span", null, "Week starts Monday")),
        h("span", { class: "row" }, weekSunday, h("span", null, "Sunday")),
        h("fieldset", { class: "row" }, h("legend", null, "Working days"), ...dayBoxes),
        h("span", null, h("label", null, "Workday start"), startInput),
        h("span", null, h("label", null, "Workday end"), endInput),
        h("span", null, h("label", null, "Report gaps longer than (min)"), gapInput),
        h("span", null, h("label", null, "Idle prompt after (min)"), idleInput),
      ));

    function save(): void {
      ctx.app.saveSoon();
      ctx.app.emit();
    }
  }

  function notificationsSection(ctx: UiContext): HTMLElement {
    const toggle = h("input", { type: "checkbox" }) as HTMLInputElement;
    toggle.checked = s.notificationsEnabled;
    const statusLine = h("span", { class: "muted" }, notificationStatus());
    toggle.addEventListener("change", () => {
      s.notificationsEnabled = toggle.checked;
      ctx.app.saveSoon();
      statusLine.textContent = notificationStatus();
    });
    const requestBtn = h("button", {
      onclick: async () => {
        if ("Notification" in window) {
          await Notification.requestPermission();
          statusLine.textContent = notificationStatus();
        }
      },
    }, "Request browser permission");
    return section("Notifications",
      h("div", { class: "row" },
        toggle, h("span", null, "Notify at interval boundaries"),
        requestBtn,
        statusLine,
      ),
      h("p", { class: "faint" }, "Without browser permission Tempotrack shows an in-app banner instead. Notifications never contain motivational text."));
  }

  function dataSection(ctx: UiContext): HTMLElement {
    const fileNote = h("p", { class: "muted" },
      `Your data lives in this browser's local storage under the key tempotrack.data.v2 (plus a .prev backup copy). It is not sent anywhere.`);
    const download = (name: string, makeText: () => string, mime: string) => {
      const blob = new Blob([makeText()], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    };
    const restoreInput = h("input", { type: "file", accept: "application/json,.json" }) as HTMLInputElement;
    restoreInput.addEventListener("change", async () => {
      const file = restoreInput.files?.[0];
      if (!file) return;
      try {
        const restored = ctx.app.store.restoreFromExport(await file.text());
        ctx.app.db = restored;
        ctx.app.db.engineSnapshot = null;
        document.documentElement.dataset.theme = ctx.app.db.settings.theme;
        ctx.app.saveNow();
        ctx.app.showBanner("Backup restored.");
        ctx.app.emit();
      } catch (err) {
        ctx.app.showError(String((err as Error).message));
      }
    });
    return section("Your data",
      h("div", null,
        fileNote,
        h("div", { class: "row" },
          h("button", { onclick: () => download(`tempotrack-backup-${new Date().toISOString().slice(0, 10)}.json`, () => JSON.stringify({ app: "tempotrack", exportedAtWall: Date.now(), database: ctx.app.db }, null, 2), "application/json") }, "Download backup"),
          h("button", { onclick: () => download(`tempotrack-export-${new Date().toISOString().slice(0, 10)}.json`, () => ctx.app.store.export(ctx.app.db, ctx.app.now()), "application/json") }, "Full export"),
          h("span", { class: "row" }, restoreInput),
        ),
        h("div", { class: "row", style: "margin-top: var(--space-4)" },
          h("button", {
            onclick: () => {
              const sample = buildSampleDatabase(ctx.app.now()) as unknown as typeof ctx.app.db;
              sample.settings = ctx.app.db.settings;
              ctx.app.db = sample;
              document.documentElement.dataset.theme = ctx.app.db.settings.theme;
              ctx.app.saveNow();
              ctx.app.showBanner("Synthetic sample data loaded (fictional projects).");
              ctx.app.emit();
            },
          }, "Load synthetic sample data"),
          h("button", {
            class: "danger",
            onclick: () => {
              if (!window.confirm("Delete ALL local data? Export a backup first — this cannot be undone.")) return;
              localStorage.clear();
              location.reload();
            },
          }, "Delete all data"),
        ),
      ),
    );
  }

  function notificationStatus(): string {
    if (!("Notification" in window)) return "Browser notifications unavailable — banners will be used.";
    return `Browser permission: ${Notification.permission}.`;
  }

  function section(title: string, body: Node, note?: Node): HTMLElement {
    return h("section", { class: "card", style: "margin-bottom: var(--space-5)" }, h("h2", null, title), body, note ?? null);
  }

  function timeInput(minutes: number): HTMLInputElement {
    return h("input", { type: "time", value: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` }) as HTMLInputElement;
  }

  function toMinutes(input: HTMLInputElement): number {
    const [hPart, mPart] = input.value.split(":");
    const m = Number(hPart) * 60 + Number(mPart ?? 0);
    return Number.isFinite(m) ? m : 9 * 60;
  }
}
