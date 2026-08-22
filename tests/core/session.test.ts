import { beforeEach, describe, expect, it } from "vitest";
import { SessionEngine, type FinalizedSegment, type SessionRef } from "../../src/core/session.js";
import { ManualClock } from "../helpers/clock.js";

const REF: SessionRef = { projectId: "p1", taskId: null, tagIds: [], billable: false };

function makeEngine(clock: ManualClock) {
  const segments: FinalizedSegment[] = [];
  const checkpoints: number[] = [];
  const engine = new SessionEngine(clock, {
    onSegmentFinished: (s) => segments.push(s),
    onCheckpoint: () => checkpoints.push(clock.wallMs()),
  });
  return { engine, segments, checkpoints };
}

describe("SessionEngine timing correctness", () => {
  let clock: ManualClock;

  beforeEach(() => {
    clock = new ManualClock();
  });

  it("accumulates stopwatch time exactly", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(90_000);
    expect(engine.evaluate().elapsedMs).toBe(90_000);
    clock.advance(30_000);
    const seg = engine.stop();
    expect(seg!.durationMs).toBe(120_000);
  });

  it("pause and resume commit exact spans", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(50_000);
    engine.pause();
    clock.advance(500_000);
    expect(engine.evaluate().elapsedMs).toBe(50_000);
    engine.resume();
    clock.advance(10_000);
    const seg = engine.stop();
    expect(seg!.durationMs).toBe(60_000);
  });

  it("a multi-hour suspend prompts reconciliation with exact candidates", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "pomodoro");
    clock.advance(25 * 60_000 - 1);
    clock.suspend(3 * 3_600_000);
    const st = engine.evaluate();
    expect(st.status).toBe("needsReconciliation");
    expect(st.reconciliation!.trustedElapsedMs).toBe(25 * 60_000 - 1);
    expect(st.reconciliation!.keepFullMs).toBe(25 * 60_000 - 1 + 3 * 3_600_000);
    expect(st.reconciliation!.absentMs).toBe(3 * 3_600_000);
  });

  it("discard-absent keeps true working time; keep-full credits the whole absence", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(600_000);
    clock.suspend(1_800_000);
    engine.evaluate();

    const discard = makeEngine(new ManualClock());
    // Rebuild identical state in a fresh engine to test the other branch.
    const c2 = new ManualClock();
    const e2make = makeEngine(c2);
    e2make.engine.start(REF, "stopwatch");
    c2.advance(600_000);
    c2.suspend(1_800_000);
    e2make.engine.evaluate();
    e2make.engine.resolveReconciliation("discardAbsent");
    c2.advance(60_000);
    const seg2 = e2make.engine.stop();
    expect(seg2!.durationMs).toBe(660_000);

    void discard;
    const c3 = new ManualClock();
    const e3 = makeEngine(c3);
    e3.engine.start(REF, "stopwatch");
    c3.advance(600_000);
    c3.suspend(1_800_000);
    e3.engine.evaluate();
    e3.engine.resolveReconciliation("keepFull");
    const seg3 = e3.engine.stop();
    expect(seg3!.durationMs).toBe(2_400_000);
  });

  it("discard-segment finalizes at trusted time and goes idle", () => {
    const { engine, segments } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(300_000);
    clock.suspend(900_000);
    engine.evaluate();
    engine.resolveReconciliation("discardSegment");
    expect(engine.rawStatus).toBe("idle");
    expect(segments).toHaveLength(1);
    expect(segments[0]!.durationMs).toBe(300_000);
  });

  it("a wall-clock jump backwards never shortens or negates measured time", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(700_000);
    clock.setWall(1_600_000_000_000); // rewound by ~11.5 days
    const st = engine.evaluate();
    expect(st.status).not.toBe("needsReconciliation");
    expect(st.elapsedMs).toBe(700_000);
    const seg = engine.stop();
    expect(seg!.durationMs).toBe(700_000);
    expect(seg!.startedWallMs).toBeLessThan(seg!.startedWallMs + seg!.durationMs + 1);
  });

  it("a wall-clock jump forward prompts instead of inflating silently", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(120_000);
    clock.setWall(clock.wallMs() + 5 * 3_600_000);
    const st = engine.evaluate();
    expect(st.status).toBe("needsReconciliation");
    expect(st.reconciliation!.absentMs).toBe(5 * 3_600_000);
  });

  it("recovers committed time from a crash checkpoint after suspend", () => {
    const saved = makeEngine(clock);
    saved.engine.start(REF, "stopwatch");
    clock.advance(45_000);
    saved.engine.pause();
    const snap = saved.engine.snapshot();

    clock.suspend(2 * 3_600_000);
    const revived = makeEngine(clock);
    revived.engine.applySnapshot(snap as never);
    revived.engine.resume();
    clock.advance(15_000);
    const seg = revived.engine.stop();
    expect(seg!.durationMs).toBe(60_000);
  });

  it("recovering a RUNNING snapshot across a suspend routes into the prompt", () => {
    const saved = makeEngine(clock);
    saved.engine.start(REF, "stopwatch");
    clock.advance(100_000);
    const snap = saved.engine.snapshot();
    clock.suspend(4 * 3_600_000);
    const revived = makeEngine(clock);
    revived.engine.applySnapshot(snap as never);
    const st = revived.engine.publicState();
    expect(st.status).toBe("needsReconciliation");
    expect(st.reconciliation!.trustedElapsedMs).toBe(100_000);
  });

  it("spans midnight without duration distortion (pure ms arithmetic)", () => {
    const { engine } = makeEngine(clock);
    engine.start(REF, "stopwatch");
    clock.advance(40 * 60_000);
    const seg = engine.stop();
    expect(seg!.durationMs).toBe(40 * 60_000);
    expect(seg!.observedEndWallMs - seg!.startedWallMs).toBeGreaterThanOrEqual(seg!.durationMs - 1);
  });
});
