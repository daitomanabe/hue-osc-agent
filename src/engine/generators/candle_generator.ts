/**
 * Candle mode: warm ambient with tiny flicker.
 * Restricted brightness ceiling, strict warm palette.
 */

import { Generator } from "../mode_manager.js";
import { GeneratorOutput, AudioFeatures } from "../../state/types.js";
import { ModePresetConfig } from "../../config/types.js";

export class CandleGenerator implements Generator {
  private elapsedMs = 0;
  private flickerPhase = Math.random();

  generate(
    deltaMs: number,
    audioFeatures: AudioFeatures | null,
    params: ModePresetConfig
  ): GeneratorOutput {
    this.elapsedMs += deltaMs;
    this.flickerPhase += (deltaMs / 1000) * (2.5 + params.speed * 5);

    // Base warm brightness with strict ceiling
    const baseBrightness = 0.2;
    const maxBrightness = 0.28; // Tight ceiling

    // Tiny flicker using high-frequency noise
    const flicker =
      Math.sin(this.flickerPhase * Math.PI * 2) * (0.01 + params.depth * 0.18) +
      (Math.random() - 0.5) * (0.01 + params.irregularity * 0.08);

    const brightness = Math.min(
      maxBrightness,
      baseBrightness + flicker
    );

    // Warm palette stays consistent
    const hue = params.palette_center * 360;
    const saturation = 0.4; // Warm, saturated amber

    return {
      brightnessOffset: brightness,
      hueOffset: hue,
      saturationOffset: saturation,
      spatialPhaseOffset: 0, // No spatial variation
    };
  }

  reset(): void {
    this.elapsedMs = 0;
    this.flickerPhase = Math.random();
  }
}
