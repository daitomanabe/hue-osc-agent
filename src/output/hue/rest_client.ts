/**
 * REST client: low frequency operations on Hue bridge.
 * Used for inventory, area validation, scene recall, not for continuous output.
 */

import https from "https";
import { BridgeConfig } from "../../config/types.js";

export interface HueDevice {
  id: string;
  metadata?: {
    name?: string;
  };
  type?: string;
  product_data?: {
    model_id?: string;
  };
}

export interface HueArea {
  id: string;
  metadata?: {
    name?: string;
  };
  children?: Array<{ rid: string; rtype: string }>;
  lights?: string[];
}

export class RestClient {
  private appKey: string;
  private ip: string;
  private agent: https.Agent;

  constructor(config: BridgeConfig & { app_key: string }) {
    this.ip = config.ip;
    this.appKey = config.app_key;
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  /**
   * Test bridge connectivity with a simple GET.
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest("GET", "/clip/v2/resource/light");
      return response.statusCode === 200;
    } catch (err) {
      console.error("REST test failed:", err);
      return false;
    }
  }

  /**
   * Fetch all lights on the bridge.
   */
  async getLights(): Promise<HueDevice[]> {
    const response = await this.makeRequest("GET", "/clip/v2/resource/light");
    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch lights: ${response.statusCode}`);
    }
    return (response.body as { data?: HueDevice[] }).data ?? [];
  }

  /**
   * Fetch all entertainment configurations.
   */
  async getEntertainmentAreas(): Promise<HueArea[]> {
    const response = await this.makeRequest(
      "GET",
      "/clip/v2/resource/entertainment_configuration"
    );
    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch areas: ${response.statusCode}`);
    }
    return (response.body as { data?: HueArea[] }).data ?? [];
  }

  /**
   * Get a specific entertainment area.
   */
  async getEntertainmentArea(areaId: string): Promise<HueArea> {
    const response = await this.makeRequest(
      "GET",
      `/clip/v2/resource/entertainment_configuration/${areaId}`
    );
    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch area ${areaId}: ${response.statusCode}`);
    }
    return response.body as HueArea;
  }

  /**
   * Recall a scene in a room/zone.
   */
  async recallScene(roomId: string, sceneId: string): Promise<void> {
    const body = {
      action: {
        on: { on: true },
      },
      recall: {
        action: sceneId,
      },
    };

    const response = await this.makeRequest(
      "PUT",
      `/clip/v2/resource/room/${roomId}`,
      body
    );

    if (response.statusCode !== 200) {
      throw new Error(`Failed to recall scene: ${response.statusCode}`);
    }
  }

  /**
   * Set light state via REST (low frequency admin ops only).
   */
  async setLight(
    lightId: string,
    state: {
      on?: boolean;
      bri?: number;
      hue?: number;
      sat?: number;
    }
  ): Promise<void> {
    const body = { state };
    const response = await this.makeRequest(
      "PUT",
      `/clip/v1/lights/${lightId}`,
      body
    );

    if (response.statusCode !== 200) {
      throw new Error(
        `Failed to set light ${lightId}: ${response.statusCode}`
      );
    }
  }

  /**
   * Make an HTTPS request to the bridge.
   */
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
          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode ?? 500, body: parsed });
          } catch {
            resolve({ statusCode: res.statusCode ?? 500, body: data });
          }
        });
      });

      req.on("error", reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }
}
