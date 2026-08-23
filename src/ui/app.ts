import { systemClock, type Clock } from "../core/clock.js";
import { SessionEngine, type FinalizedSegment, type PublicTimerState, type SessionRef, type TimerMode } from "../core/session.js";
import { DataStore, LocalStoragePersistence, freshDatabase } from "../data/store.js";
import { addTimerEntry, createProject as modelCreateProject, deleteEntry as modelDeleteEntry, uid } from "../data/model.js";
import type { Database, Entry, PomodoroEventType } from "../data/schema.js";
import { IdleMonitor } from "../data/idle.js";
import { formatHM } from "../core/duration.js";
import { dayKeyOf as dayKeyOfWall, startOfDayWall as dayStartOfKey, systemTzOffset } from "../analytics/time.js";

export interface IdlePrompt {
  kind: "idle";
  idleMs: number;
}

export class App {
  db: Database;
  store: DataStore;
  engine: SessionEngine;
  idle: IdleMonitor;
  route = "today";
  selectedDayKey: string;
  pendingMode: TimerMode = "pomodoro";
  pendingCountdownMin: number | null = null;
  analyticsPeriod = "last7";
  lastError: string | null = null;
  banner: string | null = null;
  bannerIsError = false;
  idlePrompt: IdlePrompt | null = null;
  private saveTimer: number | null = null;
  private listeners = new Set<() => void>();
  private tickListeners = new Set<() => void>();
  private lastAnnouncedStatus = "";

  constructor() {
    this.store = new DataStore(new LocalStoragePersistence(window.localStorage));
    const loaded = this.store.load();
    const nowWall = systemClock.wallMs();
    this.db = loaded ?? freshDatabase(nowWall);
    if (!loaded) this.saveSoon();
    this.selectedDayKey = this.dayKeyOf(nowWall);
    this.engine = new SessionEngine(systemClock, {
      onSegmentFinished: (seg) => this.onSegmentFinished(seg),
      onPhaseComplete: () => this.onPhaseComplete(undefined),
      onWorkAbandoned: (ms) => this.recordPomodoro("workAbandoned", ms),
      onCheckpoint: (snap) => {
        this.db.engineSnapshot = snap;
        this.saveSoon();
      },
      onStateChange: (st) => {
        this.announceTransition(st);
        this.notify();
      },
    });
    const saved = this.db.engineSnapshot as never;
    if (saved && typeof saved === "object" && "status" in (saved as object)) {
      this.engine.applySnapshot(saved);
    }
    this.idle = new IdleMonitor(systemClock, this.db.settings.idleThresholdMs, {
      onIdleDetected: (p) => {
        this.idlePrompt = { kind: "idle", idleMs: p.idleMs };
        this.emit();
      },
    });
    document.documentElement.dataset.theme = this.db.settings.theme;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Registered by the UI to patch live numbers in place (no DOM rebuild). */
  onTick(fn: () => void): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  private emitTick(): void {
    for (const fn of this.tickListeners) fn();
  }

  now(): number {
    return systemClock.wallMs();
  }

  dayKeyOf(wallMs: number): string {
    return dayKeyOfWall(wallMs, systemTzOffset);
  }

  startDayWall(dayKey: string): number {
    return dayStartOfKey(dayKey, systemTzOffset);
  }

  createProject(
    name: string,
    opts: { parentId?: string | null; colorIndex?: number; billableByDefault?: boolean; rateMinorPerHour?: number | null; goalTargetMs?: number | null; goalPeriod?: "day" | "week" | null } = {},
  ): void {
    modelCreateProject(this.db, name, opts, this.now());
    this.saveSoon();
    this.emit();
  }

  running(): boolean {
    return this.engine.publicState().status === "running";
  }

  currentRef(): SessionRef | null {
    return this.engine.snapshot().ref;
  }

  start(ref: SessionRef, mode: TimerMode, countdownMs?: number): void {
    try {
      this.engine.start(ref, mode, {
        config: {
          workMs: this.db.settings.pomodoro.workMin * 60_000,
          shortBreakMs: this.db.settings.pomodoro.shortBreakMin * 60_000,
          longBreakMs: this.db.settings.pomodoro.longBreakMin * 60_000,
          longBreakEvery: this.db.settings.pomodoro.longBreakEvery,
          autoStartNext: this.db.settings.pomodoro.autoStartNext,
        },
        countdownMs,
      });
      this.idle.start();
      this.saveNow();
      this.announce(this.mode === "stopwatch" ? "Stopwatch started" : `Session started`);
    } catch (err) {
      this.showError(String((err as Error).message ?? err));
    }
  }

  get mode(): TimerMode {
    return this.engine.snapshot().mode;
  }

  toggle(): void {
    const st = this.engine.publicState();
    if (st.status === "running" || st.status === "paused") {
      if (this.running()) this.engine.pause();
      else this.engine.resume();
      this.saveNow();
      this.emit();
    }
  }

  stop(): void {
    this.engine.stop();
    this.idle.stop();
    this.idlePrompt = null;
    this.saveNow();
    this.emit();
  }

  skip(): void {
    try {
      this.engine.skipPhase();
      this.saveNow();
      this.emit();
    } catch {
      // nothing to skip
    }
  }

  recentPairs(limit = 5): { projectId: string; taskId: string | null; label: string }[] {
    const seen = new Map<string, { projectId: string; taskId: string | null; at: number }>();
    for (const e of [...this.db.entries].sort((a, b) => b.createdAt - a.createdAt)) {
      const key = `${e.projectId}|${e.taskId ?? ""}`;
      if (!seen.has(key)) seen.set(key, { projectId: e.projectId, taskId: e.taskId, at: e.startedWall });
      if (seen.size >= limit) break;
    }
    return [...seen.values()].map(({ projectId, taskId }) => {
      const p = this.db.projects.find((pp) => pp.id === projectId);
      const t = taskId ? this.db.tasks.find((tt) => tt.id === taskId)?.name : null;
      return { projectId, taskId, label: `${p?.name ?? "?"}${t ? " · " + t : ""}` };
    });
  }

  projectName(id: string): string {
    return this.db.projects.find((p) => p.id === id)?.name ?? "(deleted project)";
  }

  colorOf(projectId: string): string {
    const idx = this.db.projects.find((p) => p.id === projectId)?.colorIndex ?? 0;
    return `var(--project-${(idx % 8) + 1})`;
  }

  entriesOfProject(id: string): Entry[] {
    return this.db.entries.filter((e) => e.projectId === id);
  }

  onSegmentFinished(seg: FinalizedSegment): void {
    if (seg.mode === "pomodoro") {
      if (seg.phase === "shortBreak" || seg.phase === "longBreak") {
        this.recordPomodoro(seg.workAbandoned ? "breakSkipped" : "breakCompleted", seg.durationMs);
        return;
      }
      this.recordPomodoro(seg.workCompleted ? "workCompleted" : "workAbandoned", seg.durationMs);
    }
    if (seg.durationMs <= 0 || !seg.ref) return;
    addTimerEntry(
      this.db,
      {
        projectId: seg.ref.projectId,
        taskId: seg.ref.taskId,
        tagIds: [...seg.ref.tagIds],
        billable: seg.ref.billable,
        startedWall: seg.startedWallMs,
        durationMs: seg.durationMs,
        note: "",
      },
      systemClock.wallMs(),
    );
  }

  recordPomodoro(type: PomodoroEventType, durationMs: number): void {
    this.db.pomodoroEvents.push({
      id: uid(),
      atWall: systemClock.wallMs(),
      type,
      durationMs,
      projectId: this.engine.snapshot().ref?.projectId ?? null,
    });
  }

  onPhaseComplete(_phase: unknown): void {
    this.showBanner("Interval finished.");
  }

  notify(): void {
    const st = this.engine.publicState();
    if (st.status !== "needsReconciliation" || !st.reconciliation) return;
    if ("Notification" in window && Notification.permission === "granted" && this.db.settings.notificationsEnabled) {
      try {
        new Notification("Tempotrack", { body: "The machine was away while the timer ran. Decide what to do with that time." });
      } catch {
        // notifications can fail silently; the in-app panel is always shown
      }
    }
  }

  announce(text: string): void {
    const region = document.getElementById("live-region");
    if (region) region.textContent = text;
  }

  private announceTransition(st: PublicTimerState): void {
    if (st.status === this.lastAnnouncedStatus) return;
    this.lastAnnouncedStatus = st.status;
    if (st.status === "running" && this.mode !== "pomodoro") return; // noisy otherwise
    const words: Record<string, string> = {
      running: "Timer running",
      paused: "Timer paused",
      awaiting: "Phase complete — next phase ready",
      needsReconciliation: "Away time detected",
      idle: "Timer idle",
    };
    this.announce(words[st.status] ?? "");
  }

  showBanner(text: string, isError = false): void {
    this.banner = text;
    this.bannerIsError = isError;
    window.setTimeout(() => {
      if (this.banner === text) {
        this.banner = null;
        this.emit();
      }
    }, 6000);
    this.emit();
  }

  showError(msg: string): void {
    this.lastError = msg;
    this.showBanner(msg, true);
  }

  saveSoon(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.persistQuietly();
    }, 500);
  }

  saveNow(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persistQuietly();
  }

  private persistQuietly(): void {
    try {
      this.store.save(this.db);
    } catch (err) {
      this.showError(`Could not save data: ${String((err as Error).message ?? err)}`);
    }
  }

  totalForDay(dayKey: string): number {
    return this.db.entries
      .filter((e) => this.dayKeyOf(e.startedWall) === dayKey)
      .reduce((s, e) => s + e.durationMs, 0);
  }

  fmtHM(ms: number): string {
    return formatHM(ms);
  }

  tick(): void {
    const beforeStatus = this.engine.publicState().status;
    const beforeIdle = this.idlePrompt !== null;
    const after = this.engine.evaluate();
    const afterStatus = after.status;
    if (afterStatus === "running") {
      const title =
        this.mode === "pomodoro"
          ? `${clockText(after.remainingMs)} ${this.projectName(after.ref?.projectId ?? "")} — Tempotrack`
          : `${clockText(after.elapsedMs)} ${this.projectName(after.ref?.projectId ?? "")} — Tempotrack`;
      document.title = title;
    } else if (document.title !== "Tempotrack") {
      document.title = "Tempotrack";
    }
    if (afterStatus === "needsReconciliation") {
      // The away-time decision owns the contested span; a stale idle prompt
      // for the same stretch must not linger and over-subtract later.
      this.idlePrompt = null;
    }
    const prompt = this.idle.check(afterStatus === "running");
    if (prompt && !this.idlePrompt) {
      this.idlePrompt = { kind: "idle", idleMs: prompt.idleMs };
    }
    const structural =
      beforeStatus !== afterStatus ||
      (this.idlePrompt !== null) !== beforeIdle ||
      afterStatus === "needsReconciliation";
    if (structural) {
      this.emit();
      return;
    }
    // Numbers-only updates patch the DOM in place; focus and form input survive.
    this.emitTick();
  }

  /** Replaces the whole database from a restored file and rebuilds runtime state around it. */
  restore(db: Database): void {
    this.db = db;
    this.db.engineSnapshot = null;
    document.documentElement.dataset.theme = this.db.settings.theme;
    this.engine = new SessionEngine(systemClock, {
      onSegmentFinished: (seg) => this.onSegmentFinished(seg),
      onPhaseComplete: () => this.onPhaseComplete(undefined),
      onWorkAbandoned: (ms) => this.recordPomodoro("workAbandoned", ms),
      onCheckpoint: (snap) => {
        this.db.engineSnapshot = snap;
        this.saveSoon();
      },
      onStateChange: (st) => {
        this.announceTransition(st);
        this.notify();
      },
    });
    this.idle = new IdleMonitor(systemClock, this.db.settings.idleThresholdMs, {
      onIdleDetected: (payload) => {
        this.idlePrompt = { kind: "idle", idleMs: payload.idleMs };
        this.emit();
      },
    });
    this.saveNow();
    this.showBanner("Backup restored.");
    this.emit();
  }
}

export function clockText(ms: number | null): string {
  if (ms === null) return "";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const mTotal = Math.floor(total / 60);
  const m = mTotal % 60;
  const hh = Math.floor(mTotal / 60);
  return hh > 0 ? `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
