/**
 * Floating mode: slow organic drift with noise.
 * Each fixture has a phase offset for spatial variation.
 */

import { Generator } from "../mode_manager.js";
import { GeneratorOutput, AudioFeatures } from "../../state/types.js";
import { ModePresetConfig } from "../../config/types.js";

export class FloatingGenerator implements Generator {
  private elapsedMs = 0;
  private noiseState: number[] = [];

  constructor(private fixtureCount: number) {
    // Initialize noise state per fixture
    for (let i = 0; i < fixtureCount; i++) {
      this.noiseState[i] = Math.random();
    }
  }

  generate(
    deltaMs: number,
    audioFeatures: AudioFeatures | null,
    params: ModePresetConfig
  ): GeneratorOutput {
    this.elapsedMs += deltaMs;

    // Normalize time to 0-1 cycles
    const cycleSeconds = Math.max(12, 120 - params.speed * 90);
    const t = (this.elapsedMs / 1000) % cycleSeconds;
    const normalizedT = t / cycleSeconds;

    // Base oscillation using sine waves
    const baseBrightness = 0.4 + 0.3 * Math.sin(normalizedT * Math.PI * 2);
    const baseHue =
      params.palette_center * 360 +
      params.palette_width * 360 * Math.sin((normalizedT + 0.25) * Math.PI * 2);

    // Noise component for irregularity
    const noiseAmount = this.updateNoise(params.irregularity);
    const noisedBrightness = baseBrightness + noiseAmount * params.depth;

    // Audio modulation: low frequency increases depth
    let audioDepthBoost = 0;
    if (audioFeatures) {
      audioDepthBoost = audioFeatures.low * 0.3;
    }

    return {
      brightnessOffset: Math.max(0, noisedBrightness + audioDepthBoost),
      hueOffset: baseHue,
      saturationOffset: 0.3 + params.palette_width * 0.5,
      spatialPhaseOffset: normalizedT,
    };
  }

  reset(): void {
    this.elapsedMs = 0;
  }

  private updateNoise(irregularity: number): number {
    // Perlin-like noise approximation using sine + randomness
    for (let i = 0; i < this.noiseState.length; i++) {
      this.noiseState[i] += (Math.random() - 0.5) * irregularity;
      this.noiseState[i] = Math.max(-1, Math.min(1, this.noiseState[i]));
    }
    return this.noiseState[0];
  }
}
