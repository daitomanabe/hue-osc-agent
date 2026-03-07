/**
 * Hue adapter: implements OutputAdapter for Philips Hue.
 * Combines bridge client, Entertainment rendering, and REST for admin ops.
 */

import { OutputAdapter } from "../base/output_adapter.js";
import { ResolvedFixtureState } from "../../state/types.js";
import { BridgeClient } from "./bridge_client.js";
import { EntertainmentRenderer } from "./entertainment_renderer.js";
import { AppConfig } from "../../config/types.js";

export class HueAdapter implements OutputAdapter {
  private bridgeClient: BridgeClient;
  private entertainmentRenderer: EntertainmentRenderer;
  private connected = false;

  constructor(
    config: AppConfig & { bridge: AppConfig["bridge"] & { app_key: string } }
  ) {
    this.bridgeClient = new BridgeClient(config.bridge);
    this.entertainmentRenderer = new EntertainmentRenderer({
      areaId: config.bridge.entertainment_area_id,
      fixtureIds: Object.keys(config.fixtures.phase_offsets),
    });
  }

  /**
   * Validate bridge connection and entertainment area.
   */
  async validate(): Promise<void> {
    console.log("Validating Hue bridge...");

    const connected = await this.bridgeClient.testConnection();
    if (!connected) {
      throw new Error("Bridge not reachable");
    }

    console.log("Bridge reachable");

    try {
      await this.entertainmentRenderer.connect();
      this.connected = true;
      console.log("Entertainment connection established");
    } catch (err) {
      throw new Error(`Entertainment connection failed: ${err}`);
    }
  }

  /**
   * Send a frame to the Entertainment API.
   */
  async sendFrame(fixtureStates: Map<string, ResolvedFixtureState>): Promise<void> {
    if (!this.connected) {
      throw new Error("Hue adapter not connected");
    }

    try {
      await this.entertainmentRenderer.sendFrame(fixtureStates);
    } catch (err) {
      console.error("Frame send failed:", err);
      this.connected = false;
      throw err;
    }
  }

  /**
   * Attempt reconnection.
   */
  async reconnect(): Promise<void> {
    console.log("Attempting Hue reconnect...");
    try {
      await this.validate();
    } catch (err) {
      console.error("Reconnect failed:", err);
      throw err;
    }
  }

  /**
   * Check connection status.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Shutdown gracefully.
   */
  async shutdown(): Promise<void> {
    try {
      await this.entertainmentRenderer.disconnect();
    } catch (err) {
      console.error("Shutdown error:", err);
    }
    this.connected = false;
    console.log("Hue adapter shutdown");
  }
}
