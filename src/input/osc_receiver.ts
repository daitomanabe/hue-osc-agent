/**
 * OSC receiver: listens for incoming OSC messages.
 */

import { UDPPort, UDPOptions } from "osc";
import { StateStore } from "../state/store.js";

export type OSCMessageHandler = (address: string, args: unknown[]) => void;

export class OSCReceiver {
  private port: UDPPort | null = null;
  private handlers: Map<string, OSCMessageHandler> = new Map();
  private messageCount = 0;

  constructor(private config: { osc_port: number }) {}

  /**
   * Register a handler for OSC messages at a specific address.
   */
  on(address: string, handler: OSCMessageHandler): void {
    this.handlers.set(address, handler);
  }

  /**
   * Start listening for OSC messages.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Dynamic import to avoid module issues
        const { UDPPort: OSCUDPPort } = require("osc");

        const options: UDPOptions = {
          localAddress: "0.0.0.0",
          localPort: this.config.osc_port,
          metadata: true,
        };

        this.port = new OSCUDPPort(options);

        this.port.on("ready", () => {
          console.log(`OSC receiver listening on port ${this.config.osc_port}`);
          resolve();
        });

        this.port.on("message", (oscMessage: unknown) => {
          this.handleMessage(oscMessage);
        });

        this.port.on("error", (err: unknown) => {
          console.error("OSC error:", err);
        });

        this.port.open();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop listening.
   */
  stop(): void {
    if (this.port) {
      this.port.close();
      this.port = null;
    }
  }

  /**
   * Handle incoming OSC message.
   */
  private handleMessage(oscMessage: unknown): void {
    const msg = oscMessage as { address?: string; args?: unknown[] };

    if (!msg.address) {
      console.warn("Received OSC message without address");
      return;
    }

    const handler = this.handlers.get(msg.address);
    if (handler) {
      try {
        handler(msg.address, msg.args ?? []);
        this.messageCount++;
      } catch (err) {
        console.error(`Error handling OSC message at ${msg.address}:`, err);
      }
    } else {
      // Silently ignore unregistered addresses
    }
  }

  /**
   * Get message statistics.
   */
  getStats(): { messageCount: number } {
    return { messageCount: this.messageCount };
  }
}
