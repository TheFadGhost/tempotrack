import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_POMODORO_CONFIG, type Phase, type PomodoroConfig, type SessionRef } from "../../src/core/session.js";
import { SessionEngine } from "../../src/core/session.js";
import { ManualClock } from "../helpers/clock.js";

const REF: SessionRef = { projectId: "p1", taskId: null, tagIds: [], billable: false };

interface Harness {
  engine: SessionEngine;
  segments: { phase: Phase | null; completed: boolean; abandoned: boolean; ms: number }[];
  phaseEvents: { phase: Phase; cycles: number }[];
  abandons: number[];
}

function makeEngine(clock: ManualClock, config?: Partial<PomodoroConfig>): Harness {
  const h: Harness = { engine: undefined as never, segments: [], phaseEvents: [], abandons: [] };
  const cfg = { ...DEFAULT_POMODORO_CONFIG, ...config };
  h.engine = new SessionEngine(clock, {
    onSegmentFinished: (s) =>
      h.segments.push({ phase: s.phase, completed: s.workCompleted, abandoned: s.workAbandoned, ms: s.durationMs }),
    onPhaseComplete: (phase, cycles) => h.phaseEvents.push({ phase, cycles }),
    onWorkAbandoned: (ms) => h.abandons.push(ms),
    onCheckpoint: () => {},
  });
  void cfg;
  return h;
}

function runPhase(h: Harness, clock: ManualClock): void {
  if (h.engine.rawStatus === "awaiting") h.engine.resume();
  clock.advance(h.engine.publicState().remainingMs ?? 0);
  h.engine.evaluate();
}

describe("pomodoro state machine", () => {
  let clock: ManualClock;

  beforeEach(() => {
    clock = new ManualClock();
  });

  it("runs work then short break with awaiting in between (autoStart off)", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "pomodoro");
    clock.advance(25 * 60_000);
    h.engine.evaluate();
    expect(h.engine.publicState().status).toBe("awaiting");
    expect(h.engine.publicState().phase).toBe("shortBreak");
    expect(h.segments[0]).toMatchObject({ phase: "work", completed: true });
    h.engine.resume();
    expect(h.engine.publicState().phase).toBe("shortBreak");
    expect(h.engine.publicState().remainingMs).toBe(5 * 60_000);
    clock.advance(5 * 60_000);
    h.engine.evaluate();
    expect(h.engine.publicState().phase).toBe("work");
    expect(h.engine.publicState().status).toBe("awaiting");
  });

  it("autoStart chains phases without user action", () => {
    const h = makeEngine(clock, { autoStartNext: true });
    h.engine.start(REF, "pomodoro", { config: { autoStartNext: true } });
    clock.advance(25 * 60_000);
    h.engine.evaluate();
    expect(h.engine.publicState().status).toBe("running");
    expect(h.engine.publicState().phase).toBe("shortBreak");
    clock.advance(5 * 60_000);
    h.engine.evaluate();
    expect(h.engine.publicState().phase).toBe("work");
    expect(h.segments.filter((s) => s.phase === "work")).toHaveLength(1);
    expect(h.segments.filter((s) => s.phase === "shortBreak")).toHaveLength(1);
  });

  it("long break arrives after the configured cycle count and only then", () => {
    const h = makeEngine(clock, { longBreakEvery: 2 });
    h.engine.start(REF, "pomodoro", { config: { longBreakEvery: 2 } });

    for (let i = 0; i < 2; i++) {
      runPhase(h, clock); // work
      expect(h.engine.publicState().phase).toBe(i === 0 ? "shortBreak" : "longBreak");
      runPhase(h, clock); // break
    }
    const breaks = h.segments.filter((s) => s.phase === "shortBreak" || s.phase === "longBreak");
    expect(breaks.map((b) => b.phase)).toEqual(["shortBreak", "longBreak"]);
    expect(breaks[1]!.ms).toBe(DEFAULT_POMODORO_CONFIG.longBreakMs);
    expect(h.phaseEvents.filter((e) => e.phase === "work").map((e) => e.cycles)).toEqual([1, 2]);
  });

  it("pausing during a break pauses exactly and resumes cleanly", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "pomodoro");
    runPhase(h, clock);
    h.engine.resume();
    clock.advance(2 * 60_000);
    h.engine.pause();
    clock.advance(10 * 60_000);
    expect(h.engine.evaluate().elapsedMs).toBe(2 * 60_000);
    h.engine.resume();
    clock.advance(3 * 60_000);
    h.engine.evaluate();
    expect(h.segments.filter((s) => s.phase === "shortBreak")).toHaveLength(1);
    expect(h.engine.publicState().phase).toBe("work");
  });

  it("stopping mid-work records an abandoned segment, not a completion", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "pomodoro");
    clock.advance(12 * 60_000);
    const seg = h.engine.stop();
    expect(seg!.workAbandoned).toBe(true);
    expect(seg!.workCompleted).toBe(false);
    expect(seg!.durationMs).toBe(12 * 60_000);
    expect(h.abandons).toEqual([12 * 60_000]);
    expect(h.phaseEvents).toHaveLength(0);
  });

  it("skipping mid-work counts as abandonment and arms a fresh work phase", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "pomodoro");
    clock.advance(5 * 60_000);
    h.engine.skipPhase();
    expect(h.abandons.length).toBe(1);
    expect(h.engine.publicState()).toMatchObject({ status: "awaiting", phase: "work" });
    h.engine.resume();
    expect(h.engine.publicState().remainingMs).toBe(DEFAULT_POMODORO_CONFIG.workMs);
  });

  it("abandonment does not advance the cycle counter", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "pomodoro");
    clock.advance(3 * 60_000);
    h.engine.stop();
    h.engine.start(REF, "pomodoro");
    clock.advance(25 * 60_000);
    h.engine.evaluate();
    expect(h.engine.publicState().cyclesCompleted).toBe(1);
  });

  it("completing a long break keeps the chain ready for more work", () => {
    const h = makeEngine(clock, { longBreakEvery: 1 });
    h.engine.start(REF, "pomodoro", { config: { longBreakEvery: 1 } });
    runPhase(h, clock);
    expect(h.engine.publicState().phase).toBe("longBreak");
    runPhase(h, clock);
    expect(h.engine.publicState()).toMatchObject({ status: "awaiting", phase: "work" });
  });

  it("countdown completes at exactly its target", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "countdown", { countdownMs: 600_000 });
    clock.advance(600_001);
    h.engine.evaluate();
    expect(engineIdle(h)).toBe(true);
    expect(h.segments[0]!.ms).toBe(600_000);
  });

  it("countdown across a suspend reconciles instead of completing silently", () => {
    const h = makeEngine(clock);
    h.engine.start(REF, "countdown", { countdownMs: 300_000 });
    clock.advance(100_000);
    clock.suspend(9 * 3_600_000);
    expect(h.engine.evaluate().status).toBe("needsReconciliation");
  });
});

function engineIdle(h: Harness): boolean {
  return h.engine.rawStatus === "idle";
}
