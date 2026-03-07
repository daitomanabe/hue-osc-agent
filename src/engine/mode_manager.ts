/**
 * Mode manager: owns autonomous mode generators and state.
 */

import { StateStore } from "../state/store.js";
import { GeneratorOutput, AudioFeatures } from "../state/types.js";
import { AppConfig } from "../config/types.js";
import { FloatingGenerator } from "./generators/floating_generator.js";
import { DriftGenerator } from "./generators/drift_generator.js";
import { CandleGenerator } from "./generators/candle_generator.js";
import { UnderwaterGenerator } from "./generators/underwater_generator.js";
import { IdleGenerator } from "./generators/idle_generator.js";

export interface Generator {
  generate(
    deltaMs: number,
    audioFeatures: AudioFeatures | null
  ): GeneratorOutput;
  reset(): void;
}

export class ModeManager {
  private generators: Map<string, Generator> = new Map();
  private lastGeneratorOutput: GeneratorOutput | null = null;

  constructor(
    private store: StateStore,
    private config: AppConfig
  ) {
    this.initializeGenerators();
  }

  /**
   * Initialize all built-in generators.
   */
  private initializeGenerators(): void {
    const fixtureCount = Object.keys(this.config.fixtures.phase_offsets).length;

    this.generators.set("floating", new FloatingGenerator(fixtureCount));
    this.generators.set("drift", new DriftGenerator());
    this.generators.set("candle", new CandleGenerator());
    this.generators.set("underwater", new UnderwaterGenerator());
    this.generators.set("idle", new IdleGenerator());
  }

  /**
   * Register a custom generator for a mode.
   */
  registerGenerator(modeName: string, generator: Generator): void {
    this.generators.set(modeName, generator);
  }

  /**
   * Get output from the current active mode generator.
   */
  getGeneratorOutput(deltaMs: number): GeneratorOutput {
    const state = this.store.getState();
    const generator = this.generators.get(state.activeMode.name);

    if (!generator) {
      return {
        brightnessOffset: 0,
        hueOffset: 0,
        saturationOffset: 0,
      };
    }

    this.lastGeneratorOutput = generator.generate(deltaMs, state.audioFeatures);
    return this.lastGeneratorOutput;
  }

  /**
   * Start a mode with optional params.
   */
  startMode(
    modeName: string,
    params: Record<string, number | string | boolean> = {}
  ): void {
    const generator = this.generators.get(modeName);
    if (!generator) {
      console.warn(`Generator not found for mode: ${modeName}`);
      return;
    }

    generator.reset();

    this.store.setActiveMode({
      name: modeName as never,
      enabled: true,
      startedAtMs: Date.now(),
      params,
    });

    console.log(`Mode started: ${modeName}`, params);
  }

  /**
   * Stop the current mode.
   */
  stopMode(): void {
    this.store.setActiveMode({
      name: "idle",
      enabled: false,
      startedAtMs: Date.now(),
      params: {},
    });
  }

  /**
   * Get the last generator output (for debugging).
   */
  getLastOutput(): GeneratorOutput | null {
    return this.lastGeneratorOutput;
  }
}
