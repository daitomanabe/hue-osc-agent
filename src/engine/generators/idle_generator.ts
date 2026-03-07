/**
 * Idle mode: minimal safe ambient look.
 * No motion, very low brightness.
 */

import { Generator } from "../mode_manager.js";
import { GeneratorOutput, AudioFeatures } from "../../state/types.js";

export class IdleGenerator implements Generator {
  generate(
    deltaMs: number,
    audioFeatures: AudioFeatures | null
  ): GeneratorOutput {
    return {
      brightnessOffset: 0.05,
      hueOffset: 30,
      saturationOffset: 0.1,
    };
  }

  reset(): void {}
}
