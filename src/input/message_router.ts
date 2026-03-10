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
    const audioAddresses: Array<{
      key: keyof AudioFeatures;
      addresses: string[];
    }> = [
      { key: "rms", addresses: ["/audio/rms"] },
      { key: "low", addresses: ["/audio/low"] },
      { key: "lowMid", addresses: ["/audio/lowMid", "/audio/lowmid"] },
      { key: "mid", addresses: ["/audio/mid"] },
      { key: "high", addresses: ["/audio/high"] },
      { key: "centroid", addresses: ["/audio/centroid"] },
      { key: "beatPhase", addresses: ["/audio/beatPhase", "/audio/beat_phase"] },
      { key: "tempo", addresses: ["/audio/tempo"] },
      { key: "confidence", addresses: ["/audio/confidence"] },
    ];

    audioAddresses.forEach(({ key, addresses }) => {
      addresses.forEach((address) => {
        this.oscReceiver.on(address, (_, args) => {
          this.handleAudioUpdate(key, args[0]);
        });
      });
    });

    const eventAliases: Record<string, string[]> = {
      kick: ["/event/kick"],
      snare: ["/event/snare"],
      hat: ["/event/hat"],
      drop: ["/event/drop"],
      breakdown: ["/event/breakdown"],
      sceneChange: ["/event/sceneChange", "/event/scene_change"],
    };

    Object.entries(eventAliases).forEach(([eventType, addresses]) => {
      addresses.forEach((address) => {
        this.oscReceiver.on(address, () => {
          this.recordEvent(eventType);
        });
      });
    });

    (["floating", "drift", "candle", "underwater"] as const).forEach(
      (modeName) => {
        this.oscReceiver.on(`/mode/${modeName}/start`, () => {
          this.activateMode(modeName);
        });

        this.oscReceiver.on(`/mode/${modeName}/stop`, () => {
          const activeMode = this.store.getState().activeMode;
          if (activeMode.name === modeName) {
            this.stopMode();
          }
        });

        (
          [
            "speed",
            "depth",
            "palette_center",
            "palette_width",
            "irregularity",
          ] as const
        ).forEach((paramName) => {
          this.oscReceiver.on(`/mode/${modeName}/${paramName}`, (_, args) => {
            this.updateModeParam(modeName, paramName, args[0]);
          });
        });
      }
    );

    // Stop any active mode
    this.oscReceiver.on("/mode/stop", () => {
      this.stopMode();
    });

    // System control: /system/*
    this.oscReceiver.on("/system/blackout", () => {
      this.store.setHealth({
        fallbackActive: true,
        fallbackReason: "blackout",
      });
    });

    this.oscReceiver.on("/system/safe_ambient", () => {
      this.store.setHealth({
        fallbackActive: true,
        fallbackReason: "operator_safe_ambient",
      });
    });

    this.oscReceiver.on("/system/stop_all_modes", () => {
      this.stopMode();
    });

    this.oscReceiver.on("/system/restore", () => {
      this.store.setHealth({
        fallbackActive: false,
        fallbackReason: undefined,
      });
    });

    this.oscReceiver.on("/system/ping", () => {
      this.store.setHealth({ oscAlive: true });
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
      confidence: 0,
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

  private activateMode(modeName: "floating" | "drift" | "candle" | "underwater"): void {
    const activeMode = this.store.getState().activeMode;
    const params =
      activeMode.name === modeName ? activeMode.params : {};

    this.store.setActiveMode({
      name: modeName,
      enabled: true,
      startedAtMs: Date.now(),
      params,
    });
  }

  private stopMode(): void {
    this.store.setActiveMode({
      name: "idle",
      enabled: false,
      startedAtMs: Date.now(),
      params: {},
    });
  }

  private updateModeParam(
    modeName: "floating" | "drift" | "candle" | "underwater",
    paramName:
      | "speed"
      | "depth"
      | "palette_center"
      | "palette_width"
      | "irregularity",
    value: unknown
  ): void {
    const numericValue =
      typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    const clampedValue = Math.max(0, Math.min(1, numericValue));
    const activeMode = this.store.getState().activeMode;

    if (activeMode.name !== modeName || !activeMode.enabled) {
      this.store.setActiveMode({
        name: modeName,
        enabled: true,
        startedAtMs: Date.now(),
        params: {
          [paramName]: clampedValue,
        },
      });
      return;
    }

    this.store.updateModeParams({
      [paramName]: clampedValue,
    });
  }
}
