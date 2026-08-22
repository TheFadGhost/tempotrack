import type { Clock } from "./clock.js";
import { assessSegment } from "./reconcile.js";

export const CHECKPOINT_EVERY_MS = 10_000;

export type TimerMode = "pomodoro" | "stopwatch" | "countdown";
export type Phase = "work" | "shortBreak" | "longBreak";
/** `awaiting`: previous phase finished, next phase armed but not started. */
export type EngineStatus = "idle" | "running" | "paused" | "awaiting" | "needsReconciliation";

export interface PomodoroConfig {
  workMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  longBreakEvery: number;
  autoStartNext: boolean;
}

export interface SessionRef {
  projectId: string;
  taskId: string | null;
  tagIds: string[];
  billable: boolean;
}

export interface FinalizedSegment {
  ref: SessionRef;
  mode: TimerMode;
  phase: Phase | null;
  workCompleted: boolean;
  workAbandoned: boolean;
  durationMs: number;
  startedWallMs: number;
  observedEndWallMs: number;
}

/** While a reconciliation prompt is open, snapshot.status stays "running". */
export interface EngineSnapshot {
  status: EngineStatus;
  mode: TimerMode;
  phase: Phase | null;
  pendingPhase: Phase | null;
  cyclesCompleted: number;
  accumulatedMs: number;
  phaseTargetMs: number | null;
  segmentStartedMonoMs: number | null;
  segmentStartedWallMs: number | null;
  checkpointMonoMs: number | null;
  checkpointWallMs: number | null;
  firstSegmentStartedWallMs: number | null;
  config: PomodoroConfig | null;
  ref: SessionRef | null;
}

export interface PublicTimerState {
  status: EngineStatus;
  mode: TimerMode;
  phase: Phase | null;
  cyclesCompleted: number;
  elapsedMs: number;
  remainingMs: number | null;
  progress01: number | null;
  ref: SessionRef | null;
  reconciliation: null | {
    trustedElapsedMs: number;
    keepFullMs: number;
    absentMs: number;
    gapStartedWallMs: number;
  };
}

export interface EngineHooks {
  onPhaseComplete?(phase: Phase, cyclesCompleted: number): void;
  onWorkAbandoned?(durationMs: number, cyclesCompleted: number): void;
  onSegmentFinished(segment: FinalizedSegment): void;
  onStateChange?(state: PublicTimerState): void;
  onCheckpoint?(snapshot: EngineSnapshot): void;
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  workMs: 25 * 60_000,
  shortBreakMs: 5 * 60_000,
  longBreakMs: 15 * 60_000,
  longBreakEvery: 4,
  autoStartNext: false,
};

function emptySnapshot(): EngineSnapshot {
  return {
    status: "idle",
    mode: "pomodoro",
    phase: null,
    pendingPhase: null,
    cyclesCompleted: 0,
    accumulatedMs: 0,
    phaseTargetMs: null,
    segmentStartedMonoMs: null,
    segmentStartedWallMs: null,
    checkpointMonoMs: null,
    checkpointWallMs: null,
    firstSegmentStartedWallMs: null,
    config: null,
    ref: null,
  };
}

export class SessionEngine {
  private snap: EngineSnapshot = emptySnapshot();
  private lastCheckpointWallMs = 0;

  constructor(
    private readonly clock: Clock,
    private readonly hooks: Partial<EngineHooks> = {},
  ) {}

  get rawStatus(): EngineStatus {
    return this.snap.status;
  }

  snapshot(): EngineSnapshot {
    return structuredClone(this.snap);
  }

  publicState(): PublicTimerState {
    const s = this.snap;
    const base: PublicTimerState = {
      status: s.status,
      mode: s.mode,
      phase: s.phase ?? s.pendingPhase,
      cyclesCompleted: s.cyclesCompleted,
      elapsedMs: s.accumulatedMs,
      remainingMs: null,
      progress01: null,
      ref: s.ref,
      reconciliation: null,
    };
    if (s.status === "running") {
      const a = assessSegment(s.accumulatedMs, s.segmentStartedMonoMs!, s.segmentStartedWallMs!, this.clock.monoMs(), this.clock.wallMs());
      base.elapsedMs = a.trustedElapsedMs;
      if (a.kind === "absentTime") {
        base.status = "needsReconciliation";
        base.reconciliation = {
          trustedElapsedMs: a.trustedElapsedMs,
          keepFullMs: a.keepFullMs,
          absentMs: a.absentMs,
          gapStartedWallMs: s.segmentStartedWallMs! + Math.max(0, a.trustedElapsedMs - s.accumulatedMs),
        };
      }
    }
    if (s.phaseTargetMs !== null && s.mode !== "stopwatch") {
      base.remainingMs = Math.max(0, s.phaseTargetMs - base.elapsedMs);
      base.progress01 = s.phaseTargetMs === 0 ? 1 : Math.min(1, base.elapsedMs / s.phaseTargetMs);
    }
    return base;
  }

  start(ref: SessionRef, mode: TimerMode, options: { config?: Partial<PomodoroConfig>; countdownMs?: number } = {}): void {
    if (this.snap.status !== "idle" && this.snap.status !== "awaiting") {
      throw new Error(`Cannot start from status "${this.snap.status}"`);
    }
    const nowMono = this.clock.monoMs();
    const nowWall = this.clock.wallMs();
    const cfg: PomodoroConfig = { ...DEFAULT_POMODORO_CONFIG, ...options.config };
    let phase: Phase | null = null;
    let target: number | null = null;
    if (mode === "pomodoro") {
      phase = "work";
      target = cfg.workMs;
    } else if (mode === "countdown") {
      const cd = options.countdownMs;
      if (cd === undefined || !Number.isSafeInteger(cd) || cd <= 0) {
        throw new Error("countdown requires a positive integer countdownMs");
      }
      target = cd;
    }
    this.snap = {
      ...emptySnapshot(),
      status: "running",
      mode,
      phase,
      phaseTargetMs: target,
      cyclesCompleted: mode === "pomodoro" ? this.snap.cyclesCompleted : 0,
      segmentStartedMonoMs: nowMono,
      segmentStartedWallMs: nowWall,
      checkpointMonoMs: nowMono,
      checkpointWallMs: nowWall,
      firstSegmentStartedWallMs: nowWall,
      config: mode === "pomodoro" ? cfg : null,
      ref: { ...ref },
    };
    this.lastCheckpointWallMs = nowWall;
    this.emitChange();
  }

  pause(): void {
    const s = this.snap;
    if (s.status !== "running") throw new Error(`Cannot pause from status "${s.status}"`);
    const a = assessSegment(s.accumulatedMs, s.segmentStartedMonoMs!, s.segmentStartedWallMs!, this.clock.monoMs(), this.clock.wallMs());
    if (a.kind === "absentTime") {
      this.emitChange();
      return;
    }
    s.accumulatedMs = a.trustedElapsedMs;
    s.segmentStartedMonoMs = null;
    s.segmentStartedWallMs = null;
    s.status = "paused";
    this.emitChange();
  }

  resume(): void {
    const s = this.snap;
    if (s.status === "awaiting") {
      this.beginPhase(s.pendingPhase ?? "work");
      return;
    }
    if (s.status !== "paused") throw new Error(`Cannot resume from status "${s.status}"`);
    this.stampNewSegment();
    s.status = "running";
    this.emitChange();
  }

  evaluate(): PublicTimerState {
    const s = this.snap;
    if (s.status !== "running") return this.publicState();
    const current = this.publicState();
    if (current.status === "needsReconciliation") {
      this.emitChange();
      return current;
    }
    if (this.tryCompletePhases(current)) return this.publicState();
    if (this.clock.wallMs() - this.lastCheckpointWallMs >= CHECKPOINT_EVERY_MS) this.checkpoint();
    return this.publicState();
  }

  resolveReconciliation(choice: "keepFull" | "discardAbsent" | "discardSegment"): void {
    const s = this.snap;
    if (s.status !== "running") throw new Error(`No reconciliation pending from status "${s.status}"`);
    const current = this.publicState();
    if (current.status !== "needsReconciliation" || !current.reconciliation) return;
    if (choice === "keepFull") {
      s.accumulatedMs = current.reconciliation.keepFullMs;
    } else if (choice === "discardAbsent") {
      s.accumulatedMs = current.reconciliation.trustedElapsedMs;
    } else {
      s.accumulatedMs = current.reconciliation.trustedElapsedMs;
      this.deliverSegment(s.accumulatedMs);
      this.resetToIdlePreservingCycles();
      this.emitChange();
      return;
    }
    this.stampNewSegment();
    s.status = "running";
    this.emitChange();
  }

  reassignFromReconciliation(ref: SessionRef): void {
    const s = this.snap;
    if (s.status !== "running") throw new Error(`No reconciliation pending from status "${s.status}"`);
    const current = this.publicState();
    if (current.status !== "needsReconciliation" || !current.reconciliation) return;
    this.deliverSegment(current.reconciliation.trustedElapsedMs);
    s.accumulatedMs = 0;
    s.firstSegmentStartedWallMs = this.clock.wallMs();
    s.ref = { ...ref };
    this.stampNewSegment();
    s.status = "running";
    this.emitChange();
  }

  /**
   * Resolves an idle-detected stretch that happened while running.
   * `keep`: count the whole stretch. `discard`: remove idleMs from the
   * segment. `stop`: finalize the shortened segment and go idle.
   */
  resolveIdleStretch(idleMs: number, action: "keep" | "discard" | "stop"): FinalizedSegment | null {
    const s = this.snap;
    if (s.status !== "running") throw new Error(`Cannot resolve idle from status "${s.status}"`);
    let seg: FinalizedSegment | null = null;
    const st = this.publicState();
    if (action === "keep") {
      // Nothing changes; stamps stay valid because wall kept advancing with mono.
      void st;
      return null;
    }
    const shortened = Math.max(0, st.elapsedMs - Math.max(0, idleMs));
    s.accumulatedMs = shortened;
    if (action === "stop") {
      seg = this.buildSegment(shortened);
      this.hooks.onSegmentFinished?.(seg);
      this.resetToIdlePreservingCycles();
    } else {
      this.stampNewSegment();
    }
    s.status = s.status === "running" ? "running" : s.status;
    this.emitChange();
    return seg;
  }

  /** Continues running on a new ref from now, logging prior time minus the idle stretch. */
  reassignAfterIdle(ref: SessionRef, idleMs: number): void {
    const s = this.snap;
    if (s.status !== "running") throw new Error(`Cannot reassign from status "${s.status}"`);
    const st = this.publicState();
    const shortened = Math.max(0, st.elapsedMs - Math.max(0, idleMs));
    s.accumulatedMs = shortened;
    this.deliverSegment(shortened);
    s.accumulatedMs = 0;
    s.firstSegmentStartedWallMs = this.clock.wallMs();
    s.ref = { ...ref };
    this.stampNewSegment();
    this.emitChange();
  }

  /** Swaps the project/task a running or paused session points at, keeping elapsed time intact. */
  setRef(ref: SessionRef): void {
    const s = this.snap;
    if (s.status !== "running" && s.status !== "paused" && s.status !== "awaiting") {
      throw new Error(`Cannot change project from status "${s.status}"`);
    }
    s.ref = { ...ref };
    this.emitChange();
  }

  skipPhase(): void {
    const s = this.snap;
    if (s.status !== "running" && s.status !== "paused") throw new Error(`Cannot skip from status "${s.status}"`);
    const elapsed = s.status === "paused" ? s.accumulatedMs : this.publicState().elapsedMs;
    this.completePhaseFromElapsed(elapsed, false);
  }

  stop(): FinalizedSegment | null {
    const s = this.snap;
    if (s.status === "idle") return null;
    if (s.status === "awaiting") {
      this.resetToIdlePreservingCycles();
      this.emitChange();
      return null;
    }
    let elapsed: number;
    const st = this.publicState();
    if (st.status === "needsReconciliation" && st.reconciliation) {
      elapsed = st.reconciliation.trustedElapsedMs;
    } else if (s.status === "paused") {
      elapsed = s.accumulatedMs;
    } else {
      elapsed = st.elapsedMs;
    }
    const seg = this.buildSegment(elapsed);
    if (seg.workAbandoned) this.hooks.onWorkAbandoned?.(seg.durationMs, s.cyclesCompleted);
    this.hooks.onSegmentFinished?.(seg);
    this.resetToIdlePreservingCycles();
    this.emitChange();
    return seg;
  }

  setCountdown(countdownMs: number): void {
    if (!Number.isSafeInteger(countdownMs) || countdownMs <= 0) throw new Error("countdown must be positive ms");
    this.snap.mode = "countdown";
    this.snap.phaseTargetMs = countdownMs;
    this.emitChange();
  }

  applySnapshot(restored: EngineSnapshot): void {
    this.snap = structuredClone(restored);
    if (this.snap.status === "running" && this.snap.segmentStartedMonoMs === null) {
      this.snap.status = "paused";
    }
    this.lastCheckpointWallMs = this.clock.wallMs();
    this.emitChange();
    if (this.snap.status === "running") this.evaluate();
  }

  private tryCompletePhases(current: PublicTimerState): boolean {
    const s = this.snap;
    if (s.phaseTargetMs === null || current.elapsedMs < s.phaseTargetMs) return false;
    if (s.mode === "countdown") {
      const seg = this.buildSegment(s.phaseTargetMs);
      this.hooks.onSegmentFinished?.(seg);
      this.hooks.onPhaseComplete?.("work", s.cyclesCompleted);
      this.resetToIdlePreservingCycles();
      this.emitChange();
      return true;
    }
    this.completePhaseFromElapsed(s.phaseTargetMs, true);
    return true;
  }

  private completePhaseFromElapsed(elapsedMs: number, natural: boolean): void {
    const s = this.snap;
    const phase = s.phase!;
    const target = s.phaseTargetMs ?? Infinity;

    if (s.mode !== "pomodoro") {
      const seg = this.buildSegment(elapsedMs);
      this.hooks.onSegmentFinished?.(seg);
      if (natural) this.hooks.onPhaseComplete?.("work", s.cyclesCompleted);
      this.resetToIdlePreservingCycles();
      this.emitChange();
      return;
    }

    const seg = this.buildSegment(phase === "work" ? Math.min(elapsedMs, target) : elapsedMs);
    this.hooks.onSegmentFinished?.(seg);

    if (phase === "work") {
      if (natural) {
        s.cyclesCompleted += 1;
        this.hooks.onPhaseComplete?.("work", s.cyclesCompleted);
        this.queueNextBreak();
      } else {
        this.hooks.onWorkAbandoned?.(seg.durationMs, s.cyclesCompleted);
        s.pendingPhase = "work";
        s.phase = null;
        s.accumulatedMs = 0;
        s.phaseTargetMs = s.config!.workMs;
        s.status = "awaiting";
      }
    } else {
      if (natural) this.hooks.onPhaseComplete?.(phase, s.cyclesCompleted);
      s.pendingPhase = "work";
      s.phase = null;
      s.accumulatedMs = 0;
      s.phaseTargetMs = s.config!.workMs;
      if (s.config!.autoStartNext) {
        this.beginPhase("work");
        return;
      }
      s.status = "awaiting";
    }
    this.emitChange();
  }

  private queueNextBreak(): void {
    const s = this.snap;
    const cfg = s.config!;
    const isLong = cfg.longBreakEvery > 0 && s.cyclesCompleted % cfg.longBreakEvery === 0;
    const breakPhase: Phase = isLong ? "longBreak" : "shortBreak";
    s.pendingPhase = breakPhase;
    s.phase = null;
    s.accumulatedMs = 0;
    s.phaseTargetMs = isLong ? cfg.longBreakMs : cfg.shortBreakMs;
    if (cfg.autoStartNext) {
      this.beginPhase(breakPhase);
      return;
    }
    s.status = "awaiting";
  }

  private beginPhase(phase: Phase): void {
    const s = this.snap;
    const cfg = s.config!;
    s.phase = phase;
    s.pendingPhase = null;
    s.accumulatedMs = 0;
    s.phaseTargetMs = phase === "work" ? cfg.workMs : phase === "shortBreak" ? cfg.shortBreakMs : cfg.longBreakMs;
    this.stampNewSegment();
    s.status = "running";
    this.emitChange();
  }

  private stampNewSegment(): void {
    const s = this.snap;
    const nowMono = this.clock.monoMs();
    const nowWall = this.clock.wallMs();
    s.segmentStartedMonoMs = nowMono;
    s.segmentStartedWallMs = nowWall;
    s.checkpointMonoMs = nowMono;
    s.checkpointWallMs = nowWall;
    this.lastCheckpointWallMs = nowWall;
  }

  private buildSegment(durationMs: number): FinalizedSegment {
    const s = this.snap;
    const safeDuration = Math.max(0, Math.floor(durationMs));
    const target = s.phaseTargetMs;
    return {
      ref: structuredClone(s.ref!),
      mode: s.mode,
      phase: s.phase,
      workCompleted: s.mode === "pomodoro" && s.phase === "work" && safeDuration >= (target ?? Infinity),
      workAbandoned: s.mode === "pomodoro" && s.phase === "work" && safeDuration < (target ?? Infinity),
      durationMs: safeDuration,
      startedWallMs: s.firstSegmentStartedWallMs ?? this.clock.wallMs() - safeDuration,
      observedEndWallMs: this.clock.wallMs(),
    };
  }

  private deliverSegment(durationMs: number): void {
    this.hooks.onSegmentFinished?.(this.buildSegment(durationMs));
  }

  private resetToIdlePreservingCycles(): void {
    const cycles = this.snap.cyclesCompleted;
    this.snap = emptySnapshot();
    this.snap.cyclesCompleted = cycles;
  }

  private checkpoint(): void {
    const s = this.snap;
    const nowMono = this.clock.monoMs();
    const nowWall = this.clock.wallMs();
    s.accumulatedMs += Math.max(0, nowMono - s.segmentStartedMonoMs!);
    s.segmentStartedMonoMs = nowMono;
    s.segmentStartedWallMs = nowWall;
    s.checkpointMonoMs = nowMono;
    s.checkpointWallMs = nowWall;
    this.lastCheckpointWallMs = nowWall;
    this.hooks.onCheckpoint?.(this.snapshot());
  }

  private emitChange(): void {
    this.hooks.onStateChange?.(this.publicState());
  }
}
