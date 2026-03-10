/**
 * REST client: low frequency Hue bridge operations.
 * Uses Local API V2 for inventory, validation, and degraded output fallback.
 */

import https from "https";
import { ResolvedBridgeConfig } from "../../config/types.js";
import { ResolvedFixtureState } from "../../state/types.js";

interface HueResourceRef {
  rid: string;
  rtype: string;
}

interface HueMetadata {
  name?: string;
}

export interface HueDevice {
  id: string;
  type?: string;
  metadata?: HueMetadata;
  services?: HueResourceRef[];
}

export interface HueLight {
  id: string;
  type?: string;
  owner?: HueResourceRef;
  metadata?: HueMetadata;
  on?: { on?: boolean };
  dimming?: { brightness?: number };
  color?: { xy?: { x: number; y: number } };
}

export interface HueGroupedLight {
  id: string;
  owner?: HueResourceRef;
}

export interface HueArea {
  id: string;
  metadata?: HueMetadata;
  channels?: Array<{
    channel_id?: number;
    members?: HueResourceRef[];
    member?: HueResourceRef;
  }>;
  children?: HueResourceRef[];
  services?: HueResourceRef[];
  light_services?: HueResourceRef[];
  lights?: Array<string | HueResourceRef>;
}

export interface HueContainer {
  id: string;
  type?: string;
  metadata?: HueMetadata;
  services?: HueResourceRef[];
}

export interface HueInventory {
  devices: HueDevice[];
  lights: HueLight[];
  groupedLights: HueGroupedLight[];
  rooms: HueContainer[];
  zones: HueContainer[];
  entertainmentAreas: HueArea[];
}

export class RestClient {
  private appKey: string;
  private ip: string;
  private agent: https.Agent;
  private timeoutMs: number;
  private inventory: HueInventory | null = null;
  private lightById = new Map<string, HueLight>();
  private areaById = new Map<string, HueArea>();
  private deviceById = new Map<string, HueDevice>();
  private deviceToLight = new Map<string, string>();
  private lightToDevice = new Map<string, string>();

  constructor(config: ResolvedBridgeConfig) {
    this.ip = config.ip;
    this.appKey = config.app_key;
    this.timeoutMs = config.request_timeout_ms;
    this.agent = new https.Agent({
      rejectUnauthorized: !config.allow_self_signed_cert,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest("GET", "/clip/v2/resource/light");
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }

  async refreshInventory(): Promise<HueInventory> {
    const [devices, lights, groupedLights, rooms, zones, entertainmentAreas] =
      await Promise.all([
        this.getResource<HueDevice>("device"),
        this.getResource<HueLight>("light"),
        this.getResource<HueGroupedLight>("grouped_light"),
        this.getResource<HueContainer>("room"),
        this.getResource<HueContainer>("zone"),
        this.getResource<HueArea>("entertainment_configuration"),
      ]);

    this.inventory = {
      devices,
      lights,
      groupedLights,
      rooms,
      zones,
      entertainmentAreas,
    };
    this.rebuildIndexes();

    return this.inventory;
  }

  async getLights(): Promise<HueLight[]> {
    if (!this.inventory) {
      await this.refreshInventory();
    }

    return this.inventory?.lights ?? [];
  }

  async getEntertainmentAreas(): Promise<HueArea[]> {
    if (!this.inventory) {
      await this.refreshInventory();
    }

    return this.inventory?.entertainmentAreas ?? [];
  }

  async getEntertainmentArea(areaId: string): Promise<HueArea> {
    const response = await this.makeRequest(
      "GET",
      `/clip/v2/resource/entertainment_configuration/${areaId}`
    );

    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch area ${areaId}: ${response.statusCode}`);
    }

    const body = response.body as { data?: HueArea[] } | HueArea;
    if ("data" in body && Array.isArray(body.data)) {
      const area = body.data[0];
      if (!area) {
        throw new Error(`Area ${areaId} not found`);
      }
      return area;
    }

    return body as HueArea;
  }

  async getEntertainmentAreaLightIds(areaId: string): Promise<string[]> {
    if (!this.inventory) {
      await this.refreshInventory();
    }

    const area = this.areaById.get(areaId);
    if (!area) {
      throw new Error(
        `Entertainment area '${areaId}' not found on bridge`
      );
    }

    const lightIds = this.extractAreaLightIds(area);
    if (lightIds.length === 0) {
      throw new Error(
        `Entertainment area '${areaId}' has no resolvable lights`
      );
    }

    return lightIds;
  }

  async resolveFixtureLightMap(
    fixtureIds: string[],
    entertainmentAreaId?: string,
    explicitLightIds: Record<string, string> = {}
  ): Promise<Map<string, string>> {
    if (!this.inventory) {
      await this.refreshInventory();
    }

    const preferredLightIds =
      entertainmentAreaId && this.areaById.has(entertainmentAreaId)
        ? this.extractAreaLightIds(this.areaById.get(entertainmentAreaId) as HueArea)
        : [];
    const allLightIds = this.inventory?.lights.map((light) => light.id) ?? [];
    const candidateLightIds = Array.from(
      new Set([...preferredLightIds, ...allLightIds])
    );

    if (candidateLightIds.length === 0) {
      throw new Error("Bridge inventory contains no resolvable lights");
    }

    const resolved = new Map<string, string>();
    const usedLightIds = new Set<string>();

    fixtureIds.forEach((fixtureId) => {
      const requestedReference = explicitLightIds[fixtureId] ?? fixtureId;
      const directMatch = this.resolveLightReference(
        requestedReference,
        candidateLightIds
      );
      if (directMatch && !usedLightIds.has(directMatch)) {
        resolved.set(fixtureId, directMatch);
        usedLightIds.add(directMatch);
        return;
      }

      const sequentialMatch = candidateLightIds.find(
        (lightId) => !usedLightIds.has(lightId)
      );
      if (!sequentialMatch) {
        throw new Error(
          `Unable to resolve Hue light for fixture '${fixtureId}'`
        );
      }

      resolved.set(fixtureId, sequentialMatch);
      usedLightIds.add(sequentialMatch);
    });

    return resolved;
  }

  async sendResolvedFixtureStates(
    fixtureToLightMap: Map<string, string>,
    fixtureStates: Map<string, ResolvedFixtureState>,
    transitionMs: number
  ): Promise<void> {
    const jobs: Array<{
      lightId: string;
      state: ResolvedFixtureState;
    }> = [];

    fixtureToLightMap.forEach((lightId, fixtureId) => {
      const state = fixtureStates.get(fixtureId);
      if (!state) {
        return;
      }

      jobs.push({ lightId, state });
    });

    for (const job of jobs) {
      await this.setLightState(job.lightId, job.state, transitionMs);
    }
  }

  getInventorySummary(): {
    devices: number;
    lights: number;
    entertainmentAreas: number;
  } {
    return {
      devices: this.inventory?.devices.length ?? 0,
      lights: this.inventory?.lights.length ?? 0,
      entertainmentAreas: this.inventory?.entertainmentAreas.length ?? 0,
    };
  }

  private async setLightState(
    lightId: string,
    state: ResolvedFixtureState,
    transitionMs: number
  ): Promise<void> {
    const response = await this.makeRequest(
      "PUT",
      `/clip/v2/resource/light/${lightId}`,
      this.buildLightStateBody(state, transitionMs)
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Failed to set light ${lightId}: HTTP ${response.statusCode}`
      );
    }
  }

  private buildLightStateBody(
    state: ResolvedFixtureState,
    transitionMs: number
  ): Record<string, unknown> {
    const brightness = this.clamp(state.brightness * 100, 0, 100);
    const duration = Math.max(0, Math.round(transitionMs));

    if (brightness <= 0.5) {
      return {
        on: { on: false },
        dynamics: { duration },
      };
    }

    const xy = this.hsvToXy(
      state.hue,
      this.clamp(state.saturation, 0, 1),
      Math.max(state.brightness, 0.01)
    );

    return {
      on: { on: true },
      dimming: { brightness },
      color: { xy },
      dynamics: { duration },
    };
  }

  private rebuildIndexes(): void {
    this.lightById.clear();
    this.areaById.clear();
    this.deviceById.clear();
    this.deviceToLight.clear();
    this.lightToDevice.clear();

    this.inventory?.lights.forEach((light) => {
      this.lightById.set(light.id, light);
    });

    this.inventory?.entertainmentAreas.forEach((area) => {
      this.areaById.set(area.id, area);
    });

    this.inventory?.devices.forEach((device) => {
      this.deviceById.set(device.id, device);
      const lightService = device.services?.find(
        (service) => service.rtype === "light"
      );
      if (lightService?.rid) {
        this.deviceToLight.set(device.id, lightService.rid);
        this.lightToDevice.set(lightService.rid, device.id);
      }
    });
  }

  private extractAreaLightIds(area: HueArea): string[] {
    const resolved: string[] = [];
    const seen = new Set<string>();

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      if (typeof value === "string") {
        const lightId = this.resolveResourceToLightId(value);
        if (lightId && !seen.has(lightId)) {
          resolved.push(lightId);
          seen.add(lightId);
        }
        return;
      }

      if (!value || typeof value !== "object") {
        return;
      }

      const record = value as Record<string, unknown>;
      const rid = record.rid;
      const rtype = record.rtype;
      if (typeof rid === "string") {
        const lightId = this.resolveResourceToLightId(
          rid,
          typeof rtype === "string" ? rtype : undefined
        );
        if (lightId && !seen.has(lightId)) {
          resolved.push(lightId);
          seen.add(lightId);
        }
      }

      Object.values(record).forEach(visit);
    };

    visit(area.channels);
    visit(area.children);
    visit(area.services);
    visit(area.light_services);
    visit(area.lights);

    return resolved;
  }

  private resolveLightReference(
    reference: string,
    allowedLightIds: string[]
  ): string | undefined {
    const normalizedReference = reference.trim().toLowerCase();

    for (const lightId of allowedLightIds) {
      if (lightId.toLowerCase() === normalizedReference) {
        return lightId;
      }
    }

    const deviceMappedLightId = this.deviceToLight.get(reference);
    if (
      deviceMappedLightId &&
      allowedLightIds.includes(deviceMappedLightId)
    ) {
      return deviceMappedLightId;
    }

    for (const lightId of allowedLightIds) {
      const names = this.getLightNames(lightId);
      if (names.some((name) => name.toLowerCase() === normalizedReference)) {
        return lightId;
      }
    }

    return undefined;
  }

  private getLightNames(lightId: string): string[] {
    const names = new Set<string>();
    const light = this.lightById.get(lightId);
    if (light?.metadata?.name) {
      names.add(light.metadata.name);
    }

    const deviceId = this.lightToDevice.get(lightId);
    const device = deviceId ? this.deviceById.get(deviceId) : undefined;
    if (device?.metadata?.name) {
      names.add(device.metadata.name);
    }

    return Array.from(names);
  }

  private resolveResourceToLightId(
    rid: string,
    rtype?: string
  ): string | undefined {
    if (rtype === "light" && this.lightById.has(rid)) {
      return rid;
    }

    if (rtype === "device") {
      return this.deviceToLight.get(rid);
    }

    if (this.lightById.has(rid)) {
      return rid;
    }

    return this.deviceToLight.get(rid);
  }

  private async getResource<T>(type: string): Promise<T[]> {
    const response = await this.makeRequest("GET", `/clip/v2/resource/${type}`);
    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch ${type}: HTTP ${response.statusCode}`);
    }

    return (response.body as { data?: T[] }).data ?? [];
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ statusCode: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: this.ip,
        port: 443,
        path,
        method,
        agent: this.agent,
        timeout: this.timeoutMs,
        headers: {
          "hue-application-key": this.appKey,
          "Content-Type": "application/json",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (data.length === 0) {
            resolve({ statusCode: res.statusCode ?? 500, body: {} });
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode ?? 500, body: parsed });
          } catch {
            resolve({ statusCode: res.statusCode ?? 500, body: data });
          }
        });
      });

      req.on("timeout", () => {
        req.destroy(new Error(`Hue request timed out after ${this.timeoutMs}ms`));
      });
      req.on("error", reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private hsvToXy(
    hueDegrees: number,
    saturation: number,
    brightness: number
  ): { x: number; y: number } {
    const [r, g, b] = this.hsvToRgb(hueDegrees, saturation, brightness);

    const linearR =
      r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const linearG =
      g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const linearB =
      b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

    const X = linearR * 0.664511 + linearG * 0.154324 + linearB * 0.162028;
    const Y = linearR * 0.283881 + linearG * 0.668433 + linearB * 0.047685;
    const Z = linearR * 0.000088 + linearG * 0.07231 + linearB * 0.986039;
    const sum = X + Y + Z;

    if (sum === 0) {
      return { x: 0.3127, y: 0.329 };
    }

    return {
      x: X / sum,
      y: Y / sum,
    };
  }

  private hsvToRgb(
    hueDegrees: number,
    saturation: number,
    brightness: number
  ): [number, number, number] {
    const hue = ((hueDegrees % 360) + 360) % 360;
    const c = brightness * saturation;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = brightness - c;

    if (hue < 60) return [c + m, x + m, m];
    if (hue < 120) return [x + m, c + m, m];
    if (hue < 180) return [m, c + m, x + m];
    if (hue < 240) return [m, x + m, c + m];
    if (hue < 300) return [x + m, m, c + m];
    return [c + m, m, x + m];
  }
}
