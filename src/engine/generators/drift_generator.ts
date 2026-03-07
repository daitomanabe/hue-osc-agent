/**
 * Drift mode: even slower and more restrained than floating.
 * Subtle palette shifts with minimal motion.
 */

import { Generator } from "../mode_manager.js";
import { GeneratorOutput, AudioFeatures } from "../../state/types.js";

export class DriftGenerator implements Generator {
  private elapsedMs = 0;

  generate(
    deltaMs: number,
    audioFeatures: AudioFeatures | null
  ): GeneratorOutput {
    this.elapsedMs += deltaMs;

    const params = {
      speed: 0.08,
      depth: 0.1,
      palette_center: 0.5,
      palette_width: 0.05,
      irregularity: 0.05,
    };

    // Very slow cycle: 200 seconds
    const t = (this.elapsedMs / 1000) % 200;
    const normalizedT = t / 200;

    // Subtle brightness drift
    const brightness =
      0.25 + 0.15 * Math.sin(normalizedT * Math.PI * 2 * params.speed);

    // Palette center slowly shifts
    const hue =
      params.palette_center * 360 +
      params.palette_width *
        360 *
        Math.sin((normalizedT + 0.5) * Math.PI * 2 * params.speed);

    const saturation = 0.2 + params.palette_width * 0.3;

    return {
      brightnessOffset: brightness,
      hueOffset: hue,
      saturationOffset: saturation,
      spatialPhaseOffset: normalizedT * 0.1, // Minimal spatial variation
    };
  }

  reset(): void {
    this.elapsedMs = 0;
  }
}
