/**
 * Pure classification of the relationship between monotonic time and wall time
 * over a running segment. This is the single place where suspend/sleep,
 * system-clock changes and crash recovery are interpreted.
 *
 * Policy:
 *  - Monotonic delta is authoritative whenever it agrees with wall delta within
 *    tolerance, and also when wall time is BEHIND monotonic time (a backwards
 *    system-clock change cannot shorten or negate measured work).
 *  - Wall time ahead of monotonic time beyond tolerance means either the
 *    machine slept (monotonic counters may pause during sleep on some
 *    platforms) or the clock was moved forward. The engine cannot distinguish
 *    these locally, so it surfaces an explicit reconciliation prompt instead of
 *    silently crediting or discarding the difference.
 */
export const WALL_TOLERANCE_MS = 2_000;

export type SegmentAssessment =
  | { kind: "consistent"; trustedElapsedMs: number }
  | { kind: "wallBehindMono"; trustedElapsedMs: number; wallDeltaMs: number }
  | {
      kind: "absentTime";
      /** Elapsed that is trustworthy without crediting the absent gap. */
      trustedElapsedMs: number;
      /** Elapsed if the whole wall-clock absence is kept. */
      keepFullMs: number;
      /** The contested middle: keepFull minus trusted. */
      absentMs: number;
    };

export function assessSegment(
  accumulatedMs: number,
  segmentStartedMonoMs: number,
  segmentStartedWallMs: number,
  nowMonoMs: number,
  nowWallMs: number,
): SegmentAssessment {
  if (!Number.isSafeInteger(accumulatedMs) || accumulatedMs < 0) {
    throw new Error(`accumulatedMs must be a safe non-negative integer, got ${accumulatedMs}`);
  }

  const rawWallDelta = nowWallMs - segmentStartedWallMs;
  const rawMonoDelta = nowMonoMs - segmentStartedMonoMs;
  let deltaMono: number;
  if (rawMonoDelta < 0) {
    // Monotonic source moved backwards (platform reset quirk): it cannot be
    // trusted this segment, so fall back to wall-based elapsed.
    deltaMono = Math.max(0, nowWallMs - segmentStartedWallMs);
    const safe = Math.min(deltaMono, Math.max(0, rawWallDelta));
    return { kind: "consistent", trustedElapsedMs: accumulatedMs + safe };
  }
  deltaMono = rawMonoDelta;

  if (rawWallDelta < 0) {
    // Wall went backwards past the segment start (large manual clock change).
    return { kind: "wallBehindMono", trustedElapsedMs: accumulatedMs + deltaMono, wallDeltaMs: rawWallDelta };
  }
  const deltaWall = rawWallDelta;

  const diff = deltaWall - deltaMono;
  if (Math.abs(diff) <= WALL_TOLERANCE_MS) {
    return { kind: "consistent", trustedElapsedMs: accumulatedMs + deltaMono };
  }
  if (diff < 0) {
    return { kind: "wallBehindMono", trustedElapsedMs: accumulatedMs + deltaMono, wallDeltaMs: rawWallDelta };
  }
  const trustedExtra = Math.min(deltaMono, deltaWall);
  return {
    kind: "absentTime",
    trustedElapsedMs: accumulatedMs + trustedExtra,
    keepFullMs: accumulatedMs + deltaWall,
    absentMs: deltaWall - trustedExtra,
  };
}
