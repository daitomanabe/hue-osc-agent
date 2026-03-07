/**
 * Health monitor: tracks system status and detects faults.
 */

import { StateStore } from "../state/store.js";

export interface HealthReport {
  timestamp: number;
  oscAlive: boolean;
  bridgeReachable: boolean;
  entertainmentReady: boolean;
  fallbackActive: boolean;
  messageCount: number;
  frameCount: number;
  uptime: number;
}

export class HealthMonitor {
  private startTimeMs = Date.now();
  private lastMessageCountMs = Date.now();
  private lastMessageCount = 0;

  constructor(
    private store: StateStore,
    private watchdogTimeoutMs: number
  ) {}

  /**
   * Get current health status.
   */
  getReport(): HealthReport {
    const state = this.store.getState();

    return {
      timestamp: Date.now(),
      oscAlive: state.health.oscAlive,
      bridgeReachable: state.health.bridgeReachable,
      entertainmentReady: state.health.entertainmentReady,
      fallbackActive: state.health.fallbackActive,
      messageCount: state.messageCount,
      frameCount: 0, // Placeholder
      uptime: Date.now() - this.startTimeMs,
    };
  }

  /**
   * Periodic health check (call once per render frame).
   */
  check(): void {
    const state = this.store.getState();
    const now = Date.now();

    // Check if OSC has been silent
    if (state.audioFeatures) {
      const silentMs = now - state.audioFeatures.updatedAtMs;
      if (silentMs > this.watchdogTimeoutMs) {
        this.store.setHealth({ oscAlive: false });
      }
    }

    // TODO: Check bridge connectivity periodically
  }
}
