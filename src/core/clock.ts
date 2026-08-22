export interface Clock {
  /** Milliseconds on a counter that advances with real time while the process runs. */
  monoMs(): number;
  /** Wall-clock epoch milliseconds. May jump backwards or forwards at any moment. */
  wallMs(): number;
}

export const systemClock: Clock = {
  monoMs: () => Math.floor(performance.now()),
  wallMs: () => Date.now(),
};
