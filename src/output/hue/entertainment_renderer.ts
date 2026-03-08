/**
 * Entertainment renderer: outputs frames to Hue Entertainment API.
 * Uses the streaming protocol for low-latency continuous animation.
 *
 * Hue Entertainment protocol:
 * - UDP streaming to /clip/v2/entertainment_configuration/{areaId}/streams
 * - 50Hz frame rate
 * - Per-fixture XY (CIE 1931) or RGB color payload
 */

import https from "https";
import dgram from "dgram";
import { ResolvedFixtureState } from "../../state/types.js";

export interface EntertainmentConfig {
  ip: string;
  appKey: string;
  areaId: string;
  fixtureIds: string[];
}

interface EntertainmentStream {
  id: string;
  owner?: { rid: string; rtype: string };
  action?: string;
  lights?: Array<{ id: string }>;
}

export class EntertainmentRenderer {
  private connected = false;
  private config: EntertainmentConfig;
  private udpClient: dgram.Socket | null = null;
  private streamId: string | null = null;
  private frameCount = 0;

  constructor(config: EntertainmentConfig) {
    this.config = config;
  }

  /**
   * Connect to Entertainment stream.
   */
  async connect(): Promise<void> {
    try {
      // Discover active Entertainment stream or create one
      this.streamId = await this.getOrCreateStream();

      // Initialize UDP client for streaming
      this.udpClient = dgram.createSocket("udp4");

      this.connected = true;
      console.log(
        `Entertainment connected to area: ${this.config.areaId}, stream: ${this.streamId}`
      );
    } catch (err) {
      throw new Error(`Entertainment connection failed: ${err}`);
    }
  }

  /**
   * Send a frame of fixture states.
   */
  async sendFrame(
    fixtureStates: Map<string, ResolvedFixtureState>
  ): Promise<void> {
    if (!this.connected || !this.udpClient || !this.streamId) {
      throw new Error("Entertainment not connected");
    }

    try {
      const payload = this.buildFramePayload(fixtureStates);
      await this.sendUdpFrame(payload);
      this.frameCount++;
    } catch (err) {
      throw new Error(`Frame send failed: ${err}`);
    }
  }

  /**
   * Disconnect from Entertainment stream.
   */
  async disconnect(): Promise<void> {
    if (this.udpClient) {
      this.udpClient.close();
      this.udpClient = null;
    }

    // Stop the stream
    if (this.streamId) {
      try {
        await this.stopStream(this.streamId);
      } catch (err) {
        console.error("Error stopping stream:", err);
      }
    }

    this.connected = false;
    console.log(`Entertainment disconnected (${this.frameCount} frames sent)`);
  }

  /**
   * Check connection status.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get or create an active Entertainment stream.
   */
  private async getOrCreateStream(): Promise<string> {
    const response = await this.makeRequest(
      "GET",
      `/clip/v2/resource/entertainment_configuration/${this.config.areaId}/streams`
    );

    if (response.statusCode !== 200) {
      throw new Error(`Failed to get streams: ${response.statusCode}`);
    }

    const streams = (response.body as { data?: EntertainmentStream[] }).data ?? [];
    const activeStream = streams.find((s) => s.action === "start");

    if (activeStream && activeStream.id) {
      return activeStream.id;
    }

    // Create a new stream
    const createBody = {
      action: "start",
    };

    const createResp = await this.makeRequest(
      "POST",
      `/clip/v2/resource/entertainment_configuration/${this.config.areaId}/streams`,
      createBody
    );

    if (createResp.statusCode !== 201 && createResp.statusCode !== 200) {
      throw new Error(`Failed to create stream: ${createResp.statusCode}`);
    }

    const data = createResp.body as { data?: Array<{ id: string }> };
    const streamId = data.data?.[0]?.id;
    if (!streamId) {
      throw new Error("No stream ID in response");
    }

    return streamId;
  }

  /**
   * Stop an Entertainment stream.
   */
  private async stopStream(streamId: string): Promise<void> {
    const body = { action: "stop" };
    await this.makeRequest(
      "PUT",
      `/clip/v2/resource/entertainment_configuration/${this.config.areaId}/streams/${streamId}`,
      body
    );
  }

  /**
   * Build frame payload for Hue Entertainment protocol.
   * Format: command + update_at + light_id + color (2 bytes X + 2 bytes Y)
   */
  private buildFramePayload(
    fixtureStates: Map<string, ResolvedFixtureState>
  ): Buffer {
    // Hue Entertainment frame structure
    const fixtures = Array.from(fixtureStates.values());
    const bufferSize = 1 + 8 + fixtures.length * 5; // header + timestamp + per-fixture data
    const buffer = Buffer.alloc(bufferSize);

    let offset = 0;

    // Command byte: 0x00 = color update
    buffer.writeUInt8(0x00, offset);
    offset++;

    // Timestamp: milliseconds since epoch (8 bytes, big-endian)
    const timestamp = BigInt(Date.now());
    buffer.writeBigUInt64BE(timestamp, offset);
    offset += 8;

    // Per-fixture color data
    fixtures.forEach((fixture) => {
      // Convert HSV to XY (CIE 1931) color space for Hue
      const xy = this.hsvToXy(fixture.hue, fixture.saturation, fixture.brightness);

      // Write fixture ID (1 byte)
      const fixtureIndex = Array.from(
        this.config.fixtureIds
      ).indexOf(fixture.fixtureId);
      buffer.writeUInt8(fixtureIndex, offset);
      offset++;

      // Write X coordinate (2 bytes, big-endian, 0-65535 range)
      buffer.writeUInt16BE(Math.round(xy[0] * 65535), offset);
      offset += 2;

      // Write Y coordinate (2 bytes, big-endian, 0-65535 range)
      buffer.writeUInt16BE(Math.round(xy[1] * 65535), offset);
      offset += 2;
    });

    return buffer;
  }

  /**
   * Send UDP frame to Entertainment endpoint.
   */
  private async sendUdpFrame(payload: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.udpClient) {
        reject(new Error("UDP client not initialized"));
        return;
      }

      // Entertainment endpoint: bridge IP, port 2100
      this.udpClient.send(payload, 2100, this.config.ip, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Convert HSV to XY color space (CIE 1931).
   * Returns normalized [x, y] coordinates.
   */
  private hsvToXy(h: number, s: number, v: number): [number, number] {
    // First convert HSV to RGB
    const rgb = this.hsvToRgb(h, s, v);

    // Normalize RGB to 0-1
    let r = rgb[0];
    let g = rgb[1];
    let b = rgb[2];

    // Gamma correction (inverse sRGB companding)
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    // Convert to XYZ
    const x = r * 0.664511 + g * 0.154324 + b * 0.162028;
    const y = r * 0.283881 + g * 0.668433 + b * 0.047685;
    const z = r * 0.000088 + g * 0.07231 + b * 0.986039;

    const xyzSum = x + y + z;

    if (xyzSum === 0) {
      return [0.3127, 0.3290]; // Default white point
    }

    return [x / xyzSum, y / xyzSum];
  }

  /**
   * Convert HSV to RGB (0-1 normalized).
   */
  private hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const hNorm = h / 360;
    const c = v * s;
    const x = c * (1 - Math.abs((hNorm * 6) % 2 - 1));
    const m = v - c;

    let r = 0,
      g = 0,
      b = 0;

    if (hNorm < 1 / 6) {
      r = c;
      g = x;
    } else if (hNorm < 2 / 6) {
      r = x;
      g = c;
    } else if (hNorm < 3 / 6) {
      g = c;
      b = x;
    } else if (hNorm < 4 / 6) {
      g = x;
      b = c;
    } else if (hNorm < 5 / 6) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }

    return [r + m, g + m, b + m];
  }

  /**
   * Make HTTPS request to bridge.
   */
  private async makeRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ statusCode: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: this.config.ip,
        port: 443,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          "hue-application-key": this.config.appKey,
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
