/**
 * State store: the single source of truth for runtime state.
 * Provides safe read/write access with optional listeners.
 */

import {
  RuntimeState,
  AudioFeatures,
  EventFlags,
  ActiveMode,
  ManualOverride,
  RuntimeHealth,
  ResolvedFixtureState,
} from "./types.js";

export type StateChangeListener = (state: RuntimeState) => void;

export class StateStore {
  private state: RuntimeState;
  private listeners: Set<StateChangeListener> = new Set();

  constructor() {
    this.state = {
      audioFeatures: null,
      events: {},
      activeMode: {
        name: "floating",
        enabled: true,
        startedAtMs: Date.now(),
        params: {},
      },
      manualOverride: null,
      health: {
        oscAlive: false,
        bridgeReachable: false,
        entertainmentReady: false,
        fallbackActive: false,
      },
      fixtureStates: new Map(),
      lastRenderMs: Date.now(),
      messageCount: 0,
      droppedMessages: 0,
    };
  }

  /**
   * Get a snapshot of current state.
   * Safe to read, cannot be accidentally mutated.
   */
  getState(): Readonly<RuntimeState> {
    return Object.freeze({ ...this.state });
  }

  /**
   * Update audio features from OSC.
   */
  setAudioFeatures(features: AudioFeatures): void {
    this.state.audioFeatures = features;
    this.state.messageCount++;
    this.notifyListeners();
  }

  /**
   * Record an event trigger.
   */
  recordEvent(event: Partial<EventFlags>): void {
    this.state.events = { ...this.state.events, ...event };
    this.notifyListeners();
  }

  /**
   * Clear events (typically after they've been consumed by render loop).
   */
  clearEvents(): void {
    this.state.events = {};
    this.notifyListeners();
  }

  /**
   * Set the active mode.
   */
  setActiveMode(mode: ActiveMode): void {
    this.state.activeMode = mode;
    this.notifyListeners();
  }

  /**
   * Set or replace manual override state.
   */
  setManualOverride(override: ManualOverride): void {
    this.state.manualOverride = override;
    this.notifyListeners();
  }

  /**
   * Clear manual override and return control to engine layers.
   */
  clearManualOverride(): void {
    this.state.manualOverride = null;
    this.notifyListeners();
  }

  /**
   * Update mode parameters.
   */
  updateModeParams(params: Record<string, number | string | boolean>): void {
    this.state.activeMode.params = {
      ...this.state.activeMode.params,
      ...params,
    };
    this.notifyListeners();
  }

  /**
   * Update health status.
   */
  setHealth(health: Partial<RuntimeHealth>): void {
    this.state.health = { ...this.state.health, ...health };
    this.notifyListeners();
  }

  /**
   * Set resolved fixture state for output.
   */
  setFixtureState(fixtureId: string, state: ResolvedFixtureState): void {
    this.state.fixtureStates.set(fixtureId, state);
    this.notifyListeners();
  }

  /**
   * Set multiple fixture states at once.
   */
  setFixtureStates(states: Map<string, ResolvedFixtureState>): void {
    this.state.fixtureStates = new Map(states);
    this.notifyListeners();
  }

  /**
   * Get all resolved fixture states.
   */
  getFixtureStates(): Map<string, ResolvedFixtureState> {
    return new Map(this.state.fixtureStates);
  }

  /**
   * Record render frame timestamp.
   */
  recordRender(): void {
    this.state.lastRenderMs = Date.now();
  }

  /**
   * Increment dropped message counter.
   */
  recordDroppedMessage(): void {
    this.state.droppedMessages++;
  }

  /**
   * Register a listener for state changes.
   */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change.
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.getState());
      } catch (err) {
        console.error("State listener error:", err);
      }
    });
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    this.state = {
      audioFeatures: null,
      events: {},
      activeMode: {
        name: "floating",
        enabled: true,
        startedAtMs: Date.now(),
        params: {},
      },
      manualOverride: null,
      health: {
        oscAlive: false,
        bridgeReachable: false,
        entertainmentReady: false,
        fallbackActive: false,
      },
      fixtureStates: new Map(),
      lastRenderMs: Date.now(),
      messageCount: 0,
      droppedMessages: 0,
    };
    this.notifyListeners();
  }
}
