/**
 * Watchdog: detects faults and triggers fallback behaviors.
 */

import { StateStore } from "../state/store.js";

export class Watchdog {
  private lastOscActivityMs = Date.now();
  private fallbackEntered = false;

  constructor(
    private store: StateStore,
    private oscTimeoutMs: number
  ) {}

  /**
   * Check and enforce watchdog rules (call once per render frame).
   */
  tick(): void {
    const state = this.store.getState();
    const now = Date.now();

    if (state.manualOverride?.enabled) {
      if (
        this.fallbackEntered &&
        state.health.fallbackReason === "osc_watchdog"
      ) {
        this.store.setHealth({
          fallbackActive: false,
          fallbackReason: undefined,
        });
        this.fallbackEntered = false;
      }
      return;
    }

    // OSC watchdog: if no input for timeout duration, activate fallback
    if (state.audioFeatures) {
      this.lastOscActivityMs = state.audioFeatures.updatedAtMs;
    }

    const oscSilenceMs = now - this.lastOscActivityMs;
    if (oscSilenceMs > this.oscTimeoutMs && !this.fallbackEntered) {
      console.warn(
        `OSC watchdog triggered after ${oscSilenceMs}ms of silence. Entering fallback.`
      );
      this.store.setHealth({
        oscAlive: false,
        fallbackActive: true,
        fallbackReason: "osc_watchdog",
      });
      this.fallbackEntered = true;
    } else if (oscSilenceMs < this.oscTimeoutMs && this.fallbackEntered) {
      // OSC returned, exit fallback
      console.log("OSC watchdog reset. Exiting fallback.");
      this.store.setHealth({
        oscAlive: true,
        fallbackActive: false,
        fallbackReason: undefined,
      });
      this.fallbackEntered = false;
    }
  }

  /**
   * Reset watchdog (useful for testing).
   */
  reset(): void {
    this.lastOscActivityMs = Date.now();
    this.fallbackEntered = false;
  }
}
