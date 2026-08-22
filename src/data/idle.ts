import type { Clock } from "../core/clock.js";

export type IdleActivityKind = "pointer" | "key" | "scroll" | "visibility";

export interface IdlePromptPayload {
  /** Wall ms when activity was last seen before the idle stretch. */
  idleStartWall: number;
  /** Wall ms when the absence was detected (usually now). */
  detectedWall: number;
  idleMs: number;
}

export interface IdleHooks {
  onIdleDetected(payload: IdlePromptPayload): void;
}

/**
 * Observes ONLY interaction with this app window (pointer, keys, scroll,
 * visibility). It never inspects which other applications are open, window
 * titles or any system-wide input. When the timer is running and no
 * interaction happens for longer than the threshold, the user is asked — on
 * return — what to do with the unattended span; nothing is decided silently.
 *
 * The UI layer is responsible for forwarding only meaningful wake/activity
 * events (a window being hidden says nothing about idleness; waking does).
 */
export class IdleMonitor {
  private lastActivityMono = 0;
  private prompted = false;
  private running = false;

  constructor(
    private readonly clock: Clock,
    private readonly thresholdMs: number,
    private readonly hooks: IdleHooks,
  ) {}

  start(): void {
    this.running = true;
    this.lastActivityMono = this.clock.monoMs();
    this.prompted = false;
  }

  stop(): void {
    this.running = false;
  }

  noteActivity(kind: IdleActivityKind): void {
    this.lastActivityMono = this.clock.monoMs();
    this.prompted = false;
  }

  /**
   * Called periodically and on wake-ups (visibilitychange -> visible).
   * Fires the prompt at most once per idle stretch.
   */
  check(timerActive: boolean): IdlePromptPayload | null {
    if (!this.running || !timerActive || this.prompted) return null;
    const idleMs = this.clock.monoMs() - this.lastActivityMono;
    if (idleMs < this.thresholdMs) return null;
    this.prompted = true;
    const payload: IdlePromptPayload = {
      idleStartWall: this.clock.wallMs() - idleMs,
      detectedWall: this.clock.wallMs(),
      idleMs,
    };
    this.hooks.onIdleDetected(payload);
    return payload;
  }
}
