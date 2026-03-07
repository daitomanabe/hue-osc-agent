/**
 * Render loop: drives the engine at fixed internal tick rate.
 * Decoupled from OSC input rate.
 */

import { StateStore } from "../state/store.js";
import { RuntimeState } from "../state/types.js";

export type RenderCallback = (state: RuntimeState) => void;

export class RenderLoop {
  private running = false;
  private renderCallbacks: Set<RenderCallback> = new Set();
  private intervalId: NodeJS.Timeout | null = null;
  private frameCount = 0;
  private lastFrameTimeMs = Date.now();

  constructor(
    private store: StateStore,
    private renderHzConfig: number
  ) {}

  /**
   * Register a callback to be called on each render frame.
   */
  onRender(callback: RenderCallback): () => void {
    this.renderCallbacks.add(callback);
    return () => {
      this.renderCallbacks.delete(callback);
    };
  }

  /**
   * Start the render loop.
   */
  start(): void {
    if (this.running) {
      console.warn("Render loop already running");
      return;
    }

    this.running = true;
    const intervalMs = 1000 / this.renderHzConfig;

    this.intervalId = setInterval(() => {
      this.tick();
    }, intervalMs);

    console.log(
      `Render loop started at ${this.renderHzConfig} Hz (${intervalMs.toFixed(1)} ms interval)`
    );
  }

  /**
   * Stop the render loop.
   */
  stop(): void {
    if (!this.running) {
      console.warn("Render loop already stopped");
      return;
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.running = false;
    console.log(
      `Render loop stopped. Total frames rendered: ${this.frameCount}`
    );
  }

  /**
   * Single render tick.
   */
  private tick(): void {
    const now = Date.now();
    const deltaMs = now - this.lastFrameTimeMs;
    this.lastFrameTimeMs = now;

    const state = this.store.getState();

    // Call all render callbacks
    try {
      this.renderCallbacks.forEach((callback) => {
        callback(state);
      });
    } catch (err) {
      console.error("Render callback error:", err);
    }

    this.store.recordRender();
    this.frameCount++;
  }

  /**
   * Get render loop statistics.
   */
  getStats(): {
    running: boolean;
    frameCount: number;
    renderHz: number;
  } {
    return {
      running: this.running,
      frameCount: this.frameCount,
      renderHz: this.renderHzConfig,
    };
  }
}
