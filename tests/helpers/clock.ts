import type { Clock } from "../../src/core/clock.js";

/**
 * Fully deterministic clock for tests. Monotonic and wall time are controlled
 * independently so suspends, clock changes and drift can be simulated without
 * ever touching the real system clock.
 */
export class ManualClock implements Clock {
  private m = 0;
  private w = 1_700_000_000_000;

  monoMs(): number {
    return this.m;
  }

  wallMs(): number {
    return this.w;
  }

  /** Normal passage of time: both counters move together. */
  advance(ms: number): void {
    this.m += ms;
    this.w += ms;
  }

  /** Machine slept: wall moves, monotonic counter is frozen (worst-case platform). */
  suspend(ms: number): void {
    this.w += ms;
  }

  /** System clock was changed by hand. */
  setWall(toEpochMs: number): void {
    this.w = toEpochMs;
  }

  /** Monotonic source reset (deep platform quirk). */
  resetMono(): void {
    this.m = 0;
  }
}
