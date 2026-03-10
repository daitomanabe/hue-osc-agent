/**
 * Core state model for the OSC to Hue rendering engine.
 * These types define the shape of all runtime state.
 */

/**
 * Audio features extracted from OSC messages.
 * These drive continuous reactive modulation.
 */
export interface AudioFeatures {
  rms: number;
  low: number;
  lowMid: number;
  mid: number;
  high: number;
  centroid: number;
  beatPhase: number;
  tempo?: number;
  confidence?: number;
  updatedAtMs: number;
}

/**
 * Event flags representing one-shot transient triggers.
 * Timestamps indicate when the event occurred.
 */
export interface EventFlags {
  kickAtMs?: number;
  snareAtMs?: number;
  hatAtMs?: number;
  dropAtMs?: number;
  breakdownAtMs?: number;
  sceneChangeAtMs?: number;
}

/**
 * Active mode state. Only one mode can be active at a time,
 * but modes compose with events and continuous modulation.
 */
export interface ActiveMode {
  name: "idle" | "floating" | "drift" | "candle" | "underwater" | "manual" | "reactive";
  enabled: boolean;
  startedAtMs: number;
  params: Record<string, number | string | boolean>;
}

/**
 * Manual override state for operator or WebUI control.
 * When enabled it replaces lower-priority reactive and autonomous layers.
 */
export interface ManualOverride {
  enabled: boolean;
  brightness: number;
  hue: number;
  saturation: number;
  updatedAtMs: number;
}

/**
 * Runtime health and connectivity status.
 */
export interface RuntimeHealth {
  oscAlive: boolean;
  bridgeReachable: boolean;
  entertainmentReady: boolean;
  fallbackActive: boolean;
  fallbackReason?: string;
}

/**
 * Resolved fixture state ready for transport output.
 */
export interface ResolvedFixtureState {
  fixtureId: string;
  brightness: number;
  hue: number;
  saturation: number;
  x?: number;
  y?: number;
  colorTemperature?: number;
}

/**
 * Complete runtime state. The state store is the single source of truth.
 */
export interface RuntimeState {
  audioFeatures: AudioFeatures | null;
  events: EventFlags;
  activeMode: ActiveMode;
  manualOverride: ManualOverride | null;
  health: RuntimeHealth;
  fixtureStates: Map<string, ResolvedFixtureState>;
  lastRenderMs: number;
  messageCount: number;
  droppedMessages: number;
}

/**
 * Output from an autonomous generator.
 * Generators return normalized offsets, not raw transport values.
 */
export interface GeneratorOutput {
  brightnessOffset: number;
  hueOffset: number;
  saturationOffset: number;
  spatialPhaseOffset?: number;
}

/**
 * Capability metadata for a fixture.
 * Used for degraded mode fallback.
 */
export interface FixtureCapability {
  id: string;
  name: string;
  hasColor: boolean;
  hasColorTemperature: boolean;
  hasGradient: boolean;
  maxBrightness: number;
}
