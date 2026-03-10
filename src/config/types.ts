/**
 * Configuration schema for the Hue OSC engine.
 */

export interface BridgeConfig {
  ip: string;
  app_key_env: string; // Name of env var containing the app key
  entertainment_area_id: string;
  allow_self_signed_cert?: boolean;
  request_timeout_ms?: number;
}

export interface RuntimeConfig {
  render_hz: number;
  osc_port: number;
  watchdog_timeout_ms: number;
  log_level: "debug" | "info" | "warn" | "error";
  rest_fallback_hz?: number;
  output_backend?: "hue" | "simulator";
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
  light_ids?: Record<string, string>;
}

export interface AppConfig {
  bridge: BridgeConfig;
  runtime: RuntimeConfig;
  safe_ambient: SafeAmbientConfig;
  modes: ModesConfig;
  audio_mapping: AudioMappingConfig;
  fixtures: FixturesConfig;
  simulator?: SimulatorConfig;
  web_ui?: WebUIConfig;
}

export interface SimulatorConfig {
  bind_host?: string;
  http_port?: number;
  title?: string;
}

export interface WebUIConfig {
  enabled?: boolean;
  bind_host?: string;
  http_port?: number;
  title?: string;
}

export interface ResolvedBridgeConfig extends BridgeConfig {
  app_key: string;
  allow_self_signed_cert: boolean;
  request_timeout_ms: number;
}

export interface ResolvedRuntimeConfig extends RuntimeConfig {
  rest_fallback_hz: number;
  output_backend: "hue" | "simulator";
}

export interface ResolvedSimulatorConfig extends SimulatorConfig {
  bind_host: string;
  http_port: number;
  title: string;
}

export interface ResolvedWebUIConfig extends WebUIConfig {
  enabled: boolean;
  bind_host: string;
  http_port: number;
  title: string;
}

export interface ResolvedAppConfig extends Omit<AppConfig, "bridge" | "runtime" | "simulator" | "web_ui"> {
  bridge: ResolvedBridgeConfig;
  runtime: ResolvedRuntimeConfig;
  simulator: ResolvedSimulatorConfig;
  web_ui: ResolvedWebUIConfig;
}
