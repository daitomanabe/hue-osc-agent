/**
 * Base output adapter interface.
 * Allows pluggable transport backends (Hue, Art Net, WLED, etc).
 */

import { ResolvedFixtureState } from "../../state/types.js";

export interface OutputAdapter {
  /**
   * Validate connection and capabilities on startup.
   */
  validate(): Promise<void>;

  /**
   * Send a frame of resolved fixture states to the output.
   */
  sendFrame(fixtureStates: Map<string, ResolvedFixtureState>): Promise<void>;

  /**
   * Reconnect if connection was lost.
   */
  reconnect(): Promise<void>;

  /**
   * Check if adapter is currently connected.
   */
  isConnected(): boolean;

  /**
   * Graceful shutdown.
   */
  shutdown(): Promise<void>;
}
