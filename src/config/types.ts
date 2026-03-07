/**
 * Configuration schema for the Hue OSC engine.
 */

export interface BridgeConfig {
  ip: string;
  app_key_env: string; // Name of env var containing the app key
  entertainment_area_id: string;
}

export interface RuntimeConfig {
  render_hz: number;
  osc_port: number;
  watchdog_timeout_ms: number;
  log_level: "debug" | "info" | "warn" | "error";
}

export interface SafeAmbientConfig {
  brightness: number;
  palette_center: number;
  palette_width: number;
}

export interface ModePresetConfig {
  speed: number;
  depth: number;
  palette_center: number;
  palette_width: number;
  irregularity: number;
}

export interface ModesConfig {
  floating: ModePresetConfig;
  drift: ModePresetConfig;
  candle: ModePresetConfig;
  underwater: ModePresetConfig;
}

export interface AudioMappingConfig {
  rms_to_brightness: number;
  low_to_depth: number;
  high_to_sparkle: number;
  centroid_to_palette_shift: number;
}

export interface FixturesConfig {
  phase_offsets: Record<string, number>;
}

export interface AppConfig {
  bridge: BridgeConfig;
  runtime: RuntimeConfig;
  safe_ambient: SafeAmbientConfig;
  modes: ModesConfig;
  audio_mapping: AudioMappingConfig;
  fixtures: FixturesConfig;
}
