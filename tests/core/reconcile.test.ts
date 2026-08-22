import { describe, expect, it } from "vitest";
import { assessSegment } from "../../src/core/reconcile.js";

const START_WALL = 1_700_000_000_000;

describe("assessSegment", () => {
  it("classifies agreement within tolerance as consistent", () => {
    const a = assessSegment(60_000, 1_000, START_WALL, 61_500, START_WALL + 62_000);
    expect(a).toEqual({ kind: "consistent", trustedElapsedMs: 120_500 });
  });

  it("trusts monotonic time when the wall clock jumped backwards mid-segment", () => {
    const a = assessSegment(0, 5_000, START_WALL, 65_000, START_WALL - 3_600_000);
    expect(a.kind).toBe("wallBehindMono");
    if (a.kind === "wallBehindMono") expect(a.trustedElapsedMs).toBe(60_000);
  });

  it("never produces a negative elapsed when wall moves before the segment start", () => {
    const a = assessSegment(0, 5_000, START_WALL, 10_000, START_WALL - 600_000);
    expect(a.trustedElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("flags wall-ahead divergence as absent time with exact candidates", () => {
    const a = assessSegment(0, 0, START_WALL, 25 * 60_000, START_WALL + 145 * 60_000);
    expect(a.kind).toBe("absentTime");
    if (a.kind === "absentTime") {
      expect(a.trustedElapsedMs).toBe(25 * 60_000);
      expect(a.keepFullMs).toBe(145 * 60_000);
      expect(a.absentMs).toBe(120 * 60_000);
    }
  });

  it("falls back to wall-based elapsed when the monotonic source resets", () => {
    const a = assessSegment(30_000, 100, START_WALL, 50, START_WALL + 90_000);
    expect(a.kind).toBe("consistent");
    expect(a.trustedElapsedMs).toBe(30_000 + 90_000);
  });

  it("keeps committed accumulation intact across classifications", () => {
    const a = assessSegment(500_000, 10_000, START_WALL, 40_000, START_WALL + 3_600_000);
    if (a.kind === "absentTime") {
      expect(a.keepFullMs).toBeGreaterThan(a.trustedElapsedMs);
      expect(a.absentMs).toBe(a.keepFullMs - a.trustedElapsedMs);
    } else {
      throw new Error("expected absentTime for a 55-minute divergence");
    }
  });

  it("treats sub-tolerance jitter as consistent", () => {
    const a = assessSegment(0, 0, START_WALL, 2_000, START_WALL + 3_999);
    expect(a.kind).toBe("consistent");
  });
});
