/**
 * Hue adapter: combines bridge validation, Entertainment streaming,
 * and low-frequency REST fallback derived from the working bridge-rest tool.
 */

import { OutputAdapter } from "../base/output_adapter.js";
import { ResolvedFixtureState } from "../../state/types.js";
import { BridgeClient } from "./bridge_client.js";
import { EntertainmentRenderer } from "./entertainment_renderer.js";
import { ResolvedAppConfig } from "../../config/types.js";
import { RestClient } from "./rest_client.js";

export interface HueTransportStatus {
  backend: "hue";
  bridgeReachable: boolean;
  entertainmentConnected: boolean;
  entertainmentAreaId: string;
  entertainmentAreaLightCount: number;
  entertainmentSkippedReason?: string;
  restFallbackReady: boolean;
  restFallbackHz: number;
  transportMode: "entertainment" | "rest_fallback" | "unavailable";
  inventory: {
    devices: number;
    lights: number;
    entertainmentAreas: number;
  };
  fixtureMap: Array<{ fixtureId: string; lightId: string }>;
}

export class HueAdapter implements OutputAdapter {
  private bridgeClient: BridgeClient;
  private restClient: RestClient;
  private entertainmentRenderer: EntertainmentRenderer;
  private bridgeReachable = false;
  private entertainmentConnected = false;
  private restFallbackReady = false;
  private entertainmentAreaLightCount = 0;
  private entertainmentSkippedReason: string | undefined;
  private restFixtureMap = new Map<string, string>();
  private restIntervalMs: number;
  private effectiveRestFallbackHz: number;
  private lastRestFrameAt = 0;
  private lastRestSent = new Map<string, ResolvedFixtureState>();
  private restSendInFlight = false;

  constructor(private config: ResolvedAppConfig) {
    const fixtureCount = Math.max(
      1,
      Object.keys(config.fixtures.phase_offsets).length
    );
    const cappedRestHz = Math.min(
      config.runtime.rest_fallback_hz,
      10 / fixtureCount
    );

    this.bridgeClient = new BridgeClient(config.bridge);
    this.restClient = new RestClient(config.bridge);
    this.entertainmentRenderer = new EntertainmentRenderer({
      ip: config.bridge.ip,
      appKey: config.bridge.app_key,
      areaId: config.bridge.entertainment_area_id,
      fixtureIds: Object.keys(config.fixtures.phase_offsets),
    });
    this.effectiveRestFallbackHz = Math.max(0.25, cappedRestHz);
    this.restIntervalMs = Math.max(
      100,
      Math.round(1000 / this.effectiveRestFallbackHz)
    );
  }

  async validate(): Promise<void> {
    this.bridgeReachable = await this.bridgeClient.testConnection();
    if (!this.bridgeReachable) {
      throw new Error("Bridge not reachable");
    }

    const fixtureIds = Object.keys(this.config.fixtures.phase_offsets);
    await this.restClient.refreshInventory();
    this.restFixtureMap = await this.restClient.resolveFixtureLightMap(
      fixtureIds,
      this.config.bridge.entertainment_area_id,
      this.config.fixtures.light_ids
    );
    this.restFallbackReady = this.restFixtureMap.size > 0;
    this.entertainmentConnected = false;
    this.entertainmentSkippedReason = undefined;
    this.entertainmentAreaLightCount = 0;

    if (this.entertainmentRenderer.isConnected()) {
      try {
        await this.entertainmentRenderer.disconnect();
      } catch {
        // Best effort cleanup before reconnecting.
      }
    }

    try {
      const entertainmentLightIds =
        await this.restClient.getEntertainmentAreaLightIds(
          this.config.bridge.entertainment_area_id
        );
      this.entertainmentAreaLightCount = entertainmentLightIds.length;

      if (entertainmentLightIds.length < fixtureIds.length) {
        this.entertainmentSkippedReason =
          `Entertainment area exposes ${entertainmentLightIds.length} light(s) for ${fixtureIds.length} configured fixture(s)`;
        if (!this.restFallbackReady) {
          throw new Error(this.entertainmentSkippedReason);
        }
        return;
      }
    } catch (err) {
      this.entertainmentSkippedReason = String(err);
      if (!this.restFallbackReady) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      return;
    }

    try {
      await this.entertainmentRenderer.connect();
      this.entertainmentConnected = true;
    } catch (err) {
      this.entertainmentConnected = false;
      this.entertainmentSkippedReason = String(err);
      if (!this.restFallbackReady) {
        throw new Error(`Entertainment connection failed: ${String(err)}`);
      }
    }
  }

  async sendFrame(
    fixtureStates: Map<string, ResolvedFixtureState>
  ): Promise<void> {
    let entertainmentFailure: unknown = null;

    if (this.entertainmentConnected) {
      try {
        await this.entertainmentRenderer.sendFrame(fixtureStates);
        return;
      } catch (err) {
        this.entertainmentConnected = false;
        entertainmentFailure = err;
      }
    }

    if (this.restFallbackReady) {
      await this.sendRestFrame(fixtureStates);
    } else if (!this.bridgeReachable) {
      throw new Error("Hue bridge unavailable");
    }

    if (entertainmentFailure) {
      throw entertainmentFailure;
    }
  }

  async reconnect(): Promise<void> {
    await this.validate();
  }

  isConnected(): boolean {
    return this.bridgeReachable && (this.entertainmentConnected || this.restFallbackReady);
  }

  async shutdown(): Promise<void> {
    try {
      await this.entertainmentRenderer.disconnect();
    } catch {
      // Best effort cleanup only.
    }

    this.bridgeReachable = false;
    this.entertainmentConnected = false;
    this.restFallbackReady = false;
    this.restFixtureMap.clear();
    this.lastRestSent.clear();
  }

  getStatus(): HueTransportStatus {
    return {
      backend: "hue",
      bridgeReachable: this.bridgeReachable,
      entertainmentConnected: this.entertainmentConnected,
      entertainmentAreaId: this.config.bridge.entertainment_area_id,
      entertainmentAreaLightCount: this.entertainmentAreaLightCount,
      entertainmentSkippedReason: this.entertainmentSkippedReason,
      restFallbackReady: this.restFallbackReady,
      restFallbackHz: Number(this.effectiveRestFallbackHz.toFixed(2)),
      transportMode: this.entertainmentConnected
        ? "entertainment"
        : this.restFallbackReady
          ? "rest_fallback"
          : "unavailable",
      inventory: this.restClient.getInventorySummary(),
      fixtureMap: Array.from(this.restFixtureMap.entries()).map(
        ([fixtureId, lightId]) => ({ fixtureId, lightId })
      ),
    };
  }

  private async sendRestFrame(
    fixtureStates: Map<string, ResolvedFixtureState>
  ): Promise<void> {
    const now = Date.now();
    if (this.restSendInFlight) {
      return;
    }
    if (now - this.lastRestFrameAt < this.restIntervalMs) {
      return;
    }

    const changedFixtureStates = new Map<string, ResolvedFixtureState>();

    this.restFixtureMap.forEach((lightId, fixtureId) => {
      const state = fixtureStates.get(fixtureId);
      if (!state) {
        return;
      }

      if (this.shouldSendRestState(lightId, state)) {
        changedFixtureStates.set(fixtureId, state);
      }
    });

    if (changedFixtureStates.size === 0) {
      return;
    }

    this.restSendInFlight = true;
    this.lastRestFrameAt = now;

    try {
      await this.restClient.sendResolvedFixtureStates(
        this.restFixtureMap,
        changedFixtureStates,
        this.restIntervalMs
      );

      changedFixtureStates.forEach((state, fixtureId) => {
        const lightId = this.restFixtureMap.get(fixtureId);
        if (lightId) {
          this.lastRestSent.set(lightId, { ...state });
        }
      });
    } finally {
      this.restSendInFlight = false;
    }
  }

  private shouldSendRestState(
    lightId: string,
    nextState: ResolvedFixtureState
  ): boolean {
    const previousState = this.lastRestSent.get(lightId);
    if (!previousState) {
      return true;
    }

    const previousOn = previousState.brightness > 0.005;
    const nextOn = nextState.brightness > 0.005;
    if (previousOn !== nextOn) {
      return true;
    }

    const brightnessDelta = Math.abs(
      previousState.brightness - nextState.brightness
    );
    const saturationDelta = Math.abs(
      previousState.saturation - nextState.saturation
    );
    const hueDelta = this.minHueDistance(previousState.hue, nextState.hue);

    return (
      brightnessDelta >= 0.04 || saturationDelta >= 0.03 || hueDelta >= 5
    );
  }

  private minHueDistance(a: number, b: number): number {
    const rawDistance = Math.abs((a % 360) - (b % 360));
    return Math.min(rawDistance, 360 - rawDistance);
  }
}
