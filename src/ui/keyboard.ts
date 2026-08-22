import type { App } from "./app.js";
import { openEntryDialog, openQuickSwitcher, openHelp, uiCtx } from "./dialogs.js";
import { navigate } from "./main.js";

const ROUTE_KEYS: Record<string, string> = {
  "1": "today",
  "2": "analytics",
  "3": "reports",
  "4": "projects",
  "5": "settings",
};

export function installKeyboard(
  app: App,
  modal: HTMLDialogElement,
  rerender: () => void,
  navigateFn: (route: string) => void,
): void {
  document.addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLElement | null;
    const typing =
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" ||
        target.isContentEditable);

    if (typing && !(ev.key === "Escape")) return;

    if (ev.key === "Escape") {
      if (modal.open) modal.close();
      return;
    }
    if (modal.open) return;

    const st = app.engine.publicState();
    switch (ev.key) {
      case " ":
        if (!typing) {
          ev.preventDefault();
          if (st.status === "running" || st.status === "paused") app.toggle();
          break;
        }
        break;
      case "s":
      case "S":
        app.stop();
        rerender();
        break;
      case "k":
      case "K":
        app.skip();
        break;
      case "n":
      case "N":
        ev.preventDefault();
        openEntryDialog(uiCtx(), null);
        break;
      case "t":
      case "T":
        ev.preventDefault();
        openQuickSwitcher(uiCtx());
        break;
      case "?":
        openHelp(uiCtx());
        break;
      case "ArrowLeft":
        if (!typing && app.route === "today") {
          app.selectedDayKey = app.dayKeyOf(app.startDayWall(app.selectedDayKey) - 86_400_000);
          rerender();
        }
        break;
      case "ArrowRight":
        if (!typing && app.route === "today") {
          app.selectedDayKey = app.dayKeyOf(app.startDayWall(app.selectedDayKey) + 86_400_000);
          rerender();
        }
        break;
      default:
        if (ROUTE_KEYS[ev.key]) {
          navigateFn(ROUTE_KEYS[ev.key]!);
        }
    }
  });
}

export function wireActivityListeners(app: App): void {
  const note = () => app.idle.noteActivity("pointer");
  window.addEventListener("pointermove", note, { passive: true });
  window.addEventListener("pointerdown", note, { passive: true });
  window.addEventListener("keydown", note);
  window.addEventListener("wheel", note, { passive: true });
  window.addEventListener("scroll", note, { passive: true });
}
