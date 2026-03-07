/**
 * OSC simulator: generates synthetic OSC messages for testing.
 * Useful for offline development without real OSC sources.
 */

import { StateStore } from "../state/store.js";
import { AudioFeatures } from "../state/types.js";

export class OSCSimulator {
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(private store: StateStore) {}

  /**
   * Start generating synthetic OSC messages.
   */
  start(frequencyHz: number = 10): void {
    if (this.running) {
      console.warn("OSC simulator already running");
      return;
    }

    this.running = true;
    const intervalMs = 1000 / frequencyHz;

    console.log(`OSC simulator started at ${frequencyHz} Hz`);

    this.intervalId = setInterval(() => {
      this.generateMessage();
    }, intervalMs);
  }

  /**
   * Stop simulator.
   */
  stop(): void {
    if (!this.running) {
      console.warn("OSC simulator not running");
      return;
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.running = false;
    console.log("OSC simulator stopped");
  }

  /**
   * Generate a synthetic audio feature message.
   */
  private generateMessage(): void {
    const now = Date.now();
    const t = (now / 1000) % 10; // Cycle every 10 seconds

    const features: AudioFeatures = {
      rms: 0.3 + 0.2 * Math.sin(t * 2 * Math.PI / 10),
      low: 0.4 + 0.3 * Math.sin(t * 2 * Math.PI / 5),
      lowMid: 0.2 + 0.1 * Math.sin(t * 2 * Math.PI / 7),
      mid: 0.15 + 0.08 * Math.sin(t * 2 * Math.PI / 3),
      high: 0.1 + 0.05 * Math.sin(t * 2 * Math.PI / 2),
      centroid: 0.5 + 0.1 * Math.sin(t * 2 * Math.PI / 15),
      beatPhase: (t / 10) % 1.0,
      updatedAtMs: now,
    };

    this.store.setAudioFeatures(features);

    // Occasionally trigger a kick event
    if (Math.random() < 0.1) {
      this.store.recordEvent({ kickAtMs: now });
    }
  }
}
