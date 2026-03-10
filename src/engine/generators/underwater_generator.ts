/**
 * Underwater mode: cool palette with broad wave motion.
 * Delayed spatial movement across fixtures.
 */

import { Generator } from "../mode_manager.js";
import { GeneratorOutput, AudioFeatures } from "../../state/types.js";
import { ModePresetConfig } from "../../config/types.js";

export class UnderwaterGenerator implements Generator {
  private elapsedMs = 0;

  generate(
    deltaMs: number,
    audioFeatures: AudioFeatures | null,
    params: ModePresetConfig
  ): GeneratorOutput {
    this.elapsedMs += deltaMs;

    const cycleSeconds = Math.max(10, 110 - params.speed * 70);
    const t = (this.elapsedMs / 1000) % cycleSeconds;
    const normalizedT = t / cycleSeconds;

    // Broad wave motion with multiple frequencies
    const wave1 = Math.sin(normalizedT * Math.PI * 2);
    const wave2 = Math.sin((normalizedT + 0.3) * Math.PI * 2 * 0.7);
    const combinedWave = (wave1 + wave2 * 0.5) / 1.5;

    // Brightness oscillates with depth modulation
    const brightness = 0.3 + combinedWave * params.depth;

    // Cool palette with hue variation
    const hue =
      params.palette_center * 360 +
      params.palette_width * 360 * Math.sin((normalizedT + 0.1) * Math.PI * 2);

    // Higher saturation for underwater feel
    const saturation = 0.35 + combinedWave * 0.2;

    // Spatial phase creates wave effect across fixtures
    const spatialPhase = normalizedT;

    // Audio modulation: low frequency increases depth
    let audioBoost = 0;
    if (audioFeatures) {
      audioBoost = audioFeatures.low * 0.2;
    }

    return {
      brightnessOffset: Math.max(0, Math.min(1, brightness + audioBoost)),
      hueOffset: hue,
      saturationOffset: Math.min(1, saturation),
      spatialPhaseOffset: spatialPhase,
    };
  }

  reset(): void {
    this.elapsedMs = 0;
  }
}
