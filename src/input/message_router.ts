/**
 * Message router: dispatches OSC messages to state and handlers.
 * Enforces OSC namespace structure per OSC_SPEC.md
 */

import { StateStore } from "../state/store.js";
import { AudioFeatures } from "../state/types.js";
import { OSCReceiver } from "./osc_receiver.js";

export class MessageRouter {
  constructor(
    private store: StateStore,
    private oscReceiver: OSCReceiver
  ) {
    this.registerHandlers();
  }

  /**
   * Public method to record audio features (for replay).
   */
  recordAudioFeature(
    key: keyof AudioFeatures,
    value: number
  ): void {
    this.handleAudioUpdate(key, value);
  }

  /**
   * Public method to record events (for replay).
   */
  recordEvent(eventType: string): void {
    const events: Record<string, (ms: number) => { [key: string]: number }> = {
      kick: (ms) => ({ kickAtMs: ms }),
      snare: (ms) => ({ snareAtMs: ms }),
      hat: (ms) => ({ hatAtMs: ms }),
      drop: (ms) => ({ dropAtMs: ms }),
      breakdown: (ms) => ({ breakdownAtMs: ms }),
      sceneChange: (ms) => ({ sceneChangeAtMs: ms }),
    };
    const eventObj = events[eventType]?.(Date.now());
    if (eventObj) {
      this.store.recordEvent(eventObj);
    }
  }

  /**
   * Register all OSC message handlers.
   */
  private registerHandlers(): void {
    // Audio feature updates: /audio/*
    this.oscReceiver.on("/audio/rms", (_, args) => {
      this.handleAudioUpdate("rms", args[0]);
    });
    this.oscReceiver.on("/audio/low", (_, args) => {
      this.handleAudioUpdate("low", args[0]);
    });
    this.oscReceiver.on("/audio/lowMid", (_, args) => {
      this.handleAudioUpdate("lowMid", args[0]);
    });
    this.oscReceiver.on("/audio/mid", (_, args) => {
      this.handleAudioUpdate("mid", args[0]);
    });
    this.oscReceiver.on("/audio/high", (_, args) => {
      this.handleAudioUpdate("high", args[0]);
    });
    this.oscReceiver.on("/audio/centroid", (_, args) => {
      this.handleAudioUpdate("centroid", args[0]);
    });
    this.oscReceiver.on("/audio/beatPhase", (_, args) => {
      this.handleAudioUpdate("beatPhase", args[0]);
    });
    this.oscReceiver.on("/audio/tempo", (_, args) => {
      this.handleAudioUpdate("tempo", args[0]);
    });

    // Event triggers: /event/*
    this.oscReceiver.on("/event/kick", (_, args) => {
      this.store.recordEvent({ kickAtMs: Date.now() });
    });
    this.oscReceiver.on("/event/snare", (_, args) => {
      this.store.recordEvent({ snareAtMs: Date.now() });
    });
    this.oscReceiver.on("/event/hat", (_, args) => {
      this.store.recordEvent({ hatAtMs: Date.now() });
    });
    this.oscReceiver.on("/event/drop", (_, args) => {
      this.store.recordEvent({ dropAtMs: Date.now() });
    });
    this.oscReceiver.on("/event/breakdown", (_, args) => {
      this.store.recordEvent({ breakdownAtMs: Date.now() });
    });
    this.oscReceiver.on("/event/sceneChange", (_, args) => {
      this.store.recordEvent({ sceneChangeAtMs: Date.now() });
    });

    // Mode control: /mode/{mode}/{action}
    this.oscReceiver.on("/mode/floating/start", (_, args) => {
      this.store.setActiveMode({
        name: "floating",
        enabled: true,
        startedAtMs: Date.now(),
        params: {},
      });
    });
    this.oscReceiver.on("/mode/drift/start", (_, args) => {
      this.store.setActiveMode({
        name: "drift",
        enabled: true,
        startedAtMs: Date.now(),
        params: {},
      });
    });
    this.oscReceiver.on("/mode/candle/start", (_, args) => {
      this.store.setActiveMode({
        name: "candle",
        enabled: true,
        startedAtMs: Date.now(),
        params: {},
      });
    });
    this.oscReceiver.on("/mode/underwater/start", (_, args) => {
      this.store.setActiveMode({
        name: "underwater",
        enabled: true,
        startedAtMs: Date.now(),
        params: {},
      });
    });

    // Stop any active mode
    this.oscReceiver.on("/mode/stop", (_, args) => {
      this.store.setActiveMode({
        name: "idle",
        enabled: false,
        startedAtMs: Date.now(),
        params: {},
      });
    });

    // System control: /system/*
    this.oscReceiver.on("/system/blackout", (_, args) => {
      this.store.setHealth({
        fallbackActive: true,
        fallbackReason: "blackout",
      });
    });

    this.oscReceiver.on("/system/safe_ambient", (_, args) => {
      this.store.setHealth({
        fallbackActive: true,
        fallbackReason: "operator_safe_ambient",
      });
    });

    this.oscReceiver.on("/system/stop_all_modes", (_, args) => {
      this.store.setActiveMode({
        name: "idle",
        enabled: false,
        startedAtMs: Date.now(),
        params: {},
      });
    });

    this.oscReceiver.on("/system/restore", (_, args) => {
      this.store.setHealth({
        fallbackActive: false,
        fallbackReason: undefined,
      });
    });
  }

  /**
   * Handle audio feature update, merging with current state.
   */
  private handleAudioUpdate(
    key: keyof AudioFeatures,
    value: unknown
  ): void {
    const current = this.store.getState().audioFeatures ?? {
      rms: 0,
      low: 0,
      lowMid: 0,
      mid: 0,
      high: 0,
      centroid: 0,
      beatPhase: 0,
      updatedAtMs: Date.now(),
    };

    const updated: AudioFeatures = {
      ...current,
      [key]: typeof value === "number" ? value : 0,
      updatedAtMs: Date.now(),
    };

    this.store.setAudioFeatures(updated);

    // Mark OSC as alive
    this.store.setHealth({ oscAlive: true });
  }
}
