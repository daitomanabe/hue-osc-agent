/**
 * OSC receiver: listens for incoming OSC messages via UDP.
 * Simple implementation without external OSC library.
 */

import dgram from "dgram";

export type OSCMessageHandler = (address: string, args: unknown[]) => void;

export class OSCReceiver {
  private socket: dgram.Socket | null = null;
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
        this.socket = dgram.createSocket("udp4");

        this.socket.on("message", (msg) => {
          try {
            this.handleOscMessage(msg);
          } catch (err) {
            console.error("Error processing OSC message:", err);
          }
        });

        this.socket.on("error", (err) => {
          console.error("UDP error:", err);
        });

        this.socket.bind(this.config.osc_port, "0.0.0.0", () => {
          console.log(
            `OSC receiver listening on port ${this.config.osc_port}`
          );
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop listening.
   */
  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Parse and handle OSC message.
   * Simplified OSC parser for common message types.
   */
  private handleOscMessage(buffer: Buffer): void {
    // OSC messages start with null-terminated address
    let idx = 0;

    // Read address
    let address = "";
    while (idx < buffer.length && buffer[idx] !== 0) {
      address += String.fromCharCode(buffer[idx]);
      idx++;
    }

    // Skip null terminator and padding
    while (idx < buffer.length && buffer[idx] === 0) {
      idx++;
    }

    // Align to 4-byte boundary
    while (idx % 4 !== 0) {
      idx++;
    }

    // Read type tag string
    let typeTag = "";
    while (idx < buffer.length && buffer[idx] !== 0) {
      typeTag += String.fromCharCode(buffer[idx]);
      idx++;
    }

    // Skip null terminator and padding
    while (idx < buffer.length && buffer[idx] === 0) {
      idx++;
    }

    // Align to 4-byte boundary
    while (idx % 4 !== 0) {
      idx++;
    }

    // Parse arguments based on type tag
    const args: unknown[] = [];
    for (let i = 1; i < typeTag.length; i++) {
      const type = typeTag[i];
      if (type === "f") {
        // 32-bit float
        args.push(buffer.readFloatBE(idx));
        idx += 4;
      } else if (type === "i") {
        // 32-bit int
        args.push(buffer.readInt32BE(idx));
        idx += 4;
      } else if (type === "s") {
        // String
        let str = "";
        while (idx < buffer.length && buffer[idx] !== 0) {
          str += String.fromCharCode(buffer[idx]);
          idx++;
        }
        args.push(str);

        // Skip null terminator and padding
        while (idx < buffer.length && buffer[idx] === 0) {
          idx++;
        }

        // Align to 4-byte boundary
        while (idx % 4 !== 0) {
          idx++;
        }
      }
    }

    // Call handler
    const handler = this.handlers.get(address);
    if (handler) {
      try {
        handler(address, args);
        this.messageCount++;
      } catch (err) {
        console.error(`Error handling OSC message at ${address}:`, err);
      }
    }
  }

  /**
   * Get message statistics.
   */
  getStats(): { messageCount: number } {
    return { messageCount: this.messageCount };
  }
}
