/**
 * Hue bridge client: handles local bridge communication over HTTPS.
 * Supports both REST (for admin ops) and Entertainment (for continuous output).
 */

import https from "https";
import { ResolvedBridgeConfig } from "../../config/types.js";

export interface HueBridgeAuth {
  ip: string;
  appKey: string;
}

export interface LightState {
  state: {
    on: boolean;
    bri: number;
    hue: number;
    sat: number;
    ct?: number;
  };
}

export class BridgeClient {
  private auth: HueBridgeAuth;
  private agent: https.Agent;
  private timeoutMs: number;

  constructor(config: ResolvedBridgeConfig) {
    this.auth = {
      ip: config.ip,
      appKey: config.app_key,
    };

    // Allow self-signed certificates for local bridge
    this.agent = new https.Agent({
      rejectUnauthorized: !config.allow_self_signed_cert,
    });
    this.timeoutMs = config.request_timeout_ms;
  }

  /**
   * Test bridge connectivity.
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest("GET", "/clip/v2/resource/light");
      return response.statusCode === 200;
    } catch (err) {
      console.error("Bridge connection test failed:", err);
      return false;
    }
  }

  /**
   * Fetch device inventory.
   */
  async getDevices(): Promise<unknown[]> {
    const response = await this.makeRequest("GET", "/clip/v2/resource/light");
    return (response.body as { data: unknown[] }).data ?? [];
  }

  /**
   * Fetch entertainment areas.
   */
  async getEntertainmentAreas(): Promise<unknown[]> {
    const response = await this.makeRequest(
      "GET",
      "/clip/v2/resource/entertainment_configuration"
    );
    return (response.body as { data: unknown[] }).data ?? [];
  }

  /**
   * Get entertainment area details.
   */
  async getEntertainmentArea(areaId: string): Promise<unknown> {
    const response = await this.makeRequest(
      "GET",
      `/clip/v2/resource/entertainment_configuration/${areaId}`
    );
    return response.body;
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
        hostname: this.auth.ip,
        port: 443,
        path,
        method,
        agent: this.agent,
        timeout: this.timeoutMs,
        headers: {
          "hue-application-key": this.auth.appKey,
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
}
