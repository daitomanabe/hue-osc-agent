/**
 * Priority resolver: composes layers into final lighting intent.
 * Layer stack from TECHNICAL_DESIGN.md:
 * 1. Safety layer
 * 2. Manual override layer
 * 3. Section or scene layer
 * 4. Event accent layer
 * 5. Autonomous mode layer
 * 6. Continuous feature modulation layer
 * 7. Idle base layer
 */

import { StateStore } from "../state/store.js";
import { RuntimeState, ResolvedFixtureState } from "../state/types.js";
import { AppConfig } from "../config/types.js";
import { ModeManager } from "./mode_manager.js";

export interface LayerOutput {
  brightness: number;
  hue: number;
  saturation: number;
}

export class PriorityResolver {
  private smoothingAlpha = 0.18; // Exponential smoothing constant
  private lastLayers: Map<string, LayerOutput> = new Map();
  private deltaMs = 0;

  constructor(
    private store: StateStore,
    private config: AppConfig,
    private modeManager: ModeManager
  ) {}

  /**
   * Set the delta time for this frame (in milliseconds).
   */
  setDeltaMs(deltaMs: number): void {
    this.deltaMs = deltaMs;
  }

  /**
   * Resolve all layers into final fixture states.
   * This runs once per render frame.
   */
  resolve(fixtureIds: string[]): Map<string, ResolvedFixtureState> {
    const state = this.store.getState();
    const result = new Map<string, ResolvedFixtureState>();

    fixtureIds.forEach((fixtureId) => {
      const resolved = this.resolveSingleFixture(fixtureId, state);
      result.set(fixtureId, resolved);
    });

    return result;
  }

  /**
   * Resolve a single fixture through the priority stack.
   */
  private resolveSingleFixture(
    fixtureId: string,
    state: RuntimeState
  ): ResolvedFixtureState {
    // Start with idle base
    let layer = this.layerIdle(fixtureId, state);

    // Layer 7: Continuous modulation
    if (state.audioFeatures) {
      layer = this.blendLayers(
        layer,
        this.layerContinuousModulation(fixtureId, state),
        0.5
      );
    }

    // Layer 6: Autonomous mode
    if (state.activeMode.enabled && state.activeMode.name !== "idle") {
      const modeLayer = this.layerAutonomousMode(fixtureId, state);
      layer = this.blendLayers(layer, modeLayer, 0.85);
    }

    // Layer 5: Event accents
    if (state.events.kickAtMs || state.events.dropAtMs) {
      layer = this.blendLayers(
        layer,
        this.layerEventAccent(fixtureId, state),
        0.7
      );
    }

    // Layer 4: Scene (not implemented yet)
    // Layer 3: Manual override
    // Layer 2: Fallback
    if (state.health.fallbackActive) {
      layer = this.layerSafeAmbient();
    }

    // Layer 1: Blackout
    if (state.health.fallbackReason === "blackout") {
      return {
        fixtureId,
        brightness: 0,
        hue: 0,
        saturation: 0,
      };
    }

    // Apply exponential smoothing
    layer = this.applySmoothingToFixture(fixtureId, layer);

    return {
      fixtureId,
      brightness: Math.max(0, Math.min(1, layer.brightness)),
      hue: layer.hue % 360,
      saturation: Math.max(0, Math.min(1, layer.saturation)),
    };
  }

  /**
   * Idle base layer: minimal safe look.
   */
  private layerIdle(
    fixtureId: string,
    state: RuntimeState
  ): LayerOutput {
    return {
      brightness: 0.05,
      hue: 30,
      saturation: 0.1,
    };
  }

  /**
   * Continuous modulation from audio features.
   */
  private layerContinuousModulation(
    fixtureId: string,
    state: RuntimeState
  ): LayerOutput {
    const audio = state.audioFeatures;
    if (!audio) {
      return { brightness: 0, hue: 0, saturation: 0 };
    }

    const mapping = this.config.audio_mapping;

    return {
      brightness: audio.rms * mapping.rms_to_brightness,
      hue: audio.centroid * 360 * mapping.centroid_to_palette_shift,
      saturation: audio.high * mapping.high_to_sparkle,
    };
  }

  /**
   * Autonomous mode layer: get output from active generator.
   */
  private layerAutonomousMode(
    fixtureId: string,
    state: RuntimeState
  ): LayerOutput {
    const generatorOutput = this.modeManager.getGeneratorOutput(this.deltaMs);

    // Apply spatial phase offset for this fixture
    const fixtureIndex = Object.keys(this.config.fixtures.phase_offsets).indexOf(fixtureId);
    const phaseOffset = this.config.fixtures.phase_offsets[fixtureId] ?? 0;
    const spatialModulation = Math.sin(
      (generatorOutput.spatialPhaseOffset ?? 0) * Math.PI * 2 + phaseOffset * Math.PI * 2
    );

    return {
      brightness: generatorOutput.brightnessOffset + spatialModulation * 0.1,
      hue: generatorOutput.hueOffset,
      saturation: generatorOutput.saturationOffset,
    };
  }

  /**
   * Event accent layer (kick, drop, etc).
   */
  private layerEventAccent(
    fixtureId: string,
    state: RuntimeState
  ): LayerOutput {
    const now = Date.now();
    let brightness = 0;

    // Kick accent: 30 ms attack, 150 ms decay
    if (state.events.kickAtMs) {
      const elapsed = now - state.events.kickAtMs;
      if (elapsed < 180) {
        if (elapsed < 30) {
          brightness += (elapsed / 30) * 0.5;
        } else {
          brightness += Math.max(
            0,
            0.5 * Math.exp(-3 * ((elapsed - 30) / 150))
          );
        }
      }
    }

    // Drop accent: longer sustain
    if (state.events.dropAtMs) {
      const elapsed = now - state.events.dropAtMs;
      if (elapsed < 1500) {
        if (elapsed < 50) {
          brightness += (elapsed / 50) * 0.3;
        } else {
          brightness += 0.3;
        }
      }
    }

    return {
      brightness,
      hue: 0,
      saturation: 0.2,
    };
  }

  /**
   * Safe ambient layer.
   */
  private layerSafeAmbient(): LayerOutput {
    const sa = this.config.safe_ambient;
    return {
      brightness: sa.brightness,
      hue: sa.palette_center * 360,
      saturation: 0.1,
    };
  }

  /**
   * Blend two layers using alpha blending.
   */
  private blendLayers(
    base: LayerOutput,
    top: LayerOutput,
    alpha: number
  ): LayerOutput {
    return {
      brightness: base.brightness * (1 - alpha) + top.brightness * alpha,
      hue: base.hue * (1 - alpha) + top.hue * alpha,
      saturation: base.saturation * (1 - alpha) + top.saturation * alpha,
    };
  }

  /**
   * Apply exponential smoothing to reduce chatter.
   */
  private applySmoothingToFixture(
    fixtureId: string,
    newLayer: LayerOutput
  ): LayerOutput {
    const lastLayer = this.lastLayers.get(fixtureId) ?? {
      brightness: 0,
      hue: 0,
      saturation: 0,
    };

    // Deadband thresholds
    const brightnessDead = 0.01;
    const hueDead = 1.5; // degrees
    const saturationDead = 0.01;

    // Check if change exceeds deadband
    const brightnessDelta = Math.abs(newLayer.brightness - lastLayer.brightness);
    const hueDelta = Math.abs(newLayer.hue - lastLayer.hue);
    const saturationDelta = Math.abs(
      newLayer.saturation - lastLayer.saturation
    );

    let smoothedLayer = newLayer;

    // Apply smoothing only if delta exceeds deadband
    if (brightnessDelta > brightnessDead) {
      smoothedLayer.brightness =
        lastLayer.brightness * (1 - this.smoothingAlpha) +
        newLayer.brightness * this.smoothingAlpha;
    } else {
      smoothedLayer.brightness = lastLayer.brightness;
    }

    if (hueDelta > hueDead) {
      smoothedLayer.hue =
        lastLayer.hue * (1 - this.smoothingAlpha) +
        newLayer.hue * this.smoothingAlpha;
    } else {
      smoothedLayer.hue = lastLayer.hue;
    }

    if (saturationDelta > saturationDead) {
      smoothedLayer.saturation =
        lastLayer.saturation * (1 - this.smoothingAlpha) +
        newLayer.saturation * this.smoothingAlpha;
    } else {
      smoothedLayer.saturation = lastLayer.saturation;
    }

    this.lastLayers.set(fixtureId, smoothedLayer);
    return smoothedLayer;
  }
}
