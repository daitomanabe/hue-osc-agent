/**
 * OSC replay: record and replay OSC messages for testing.
 * Useful for deterministic testing and show replay analysis.
 */

import fs from "fs";
import { StateStore } from "../state/store.js";

export interface RecordedMessage {
  timestampMs: number;
  address: string;
  args: unknown[];
}

export interface RecordingSession {
  startTimestampMs: number;
  messages: RecordedMessage[];
}

export class OSCRecorder {
  private recording: RecordingSession | null = null;

  /**
   * Start recording OSC messages.
   */
  startRecording(): void {
    this.recording = {
      startTimestampMs: Date.now(),
      messages: [],
    };
    console.log("OSC recording started");
  }

  /**
   * Record an OSC message.
   */
  recordMessage(address: string, args: unknown[]): void {
    if (!this.recording) {
      return;
    }

    this.recording.messages.push({
      timestampMs: Date.now(),
      address,
      args,
    });
  }

  /**
   * Stop recording and save to file.
   */
  stopRecording(filepath: string): void {
    if (!this.recording) {
      console.warn("No recording in progress");
      return;
    }

    const normalizedMessages = this.recording.messages.map((msg) => ({
      ...msg,
      timestampMs: msg.timestampMs - this.recording!.startTimestampMs,
    }));

    const json = JSON.stringify(
      {
        startTimestampMs: this.recording.startTimestampMs,
        durationMs:
          normalizedMessages[normalizedMessages.length - 1]?.timestampMs ?? 0,
        messageCount: normalizedMessages.length,
        messages: normalizedMessages,
      },
      null,
      2
    );

    fs.writeFileSync(filepath, json, "utf-8");
    console.log(`OSC recording saved to ${filepath}`);

    this.recording = null;
  }
}

export class OSCReplayer {
  private playing = false;
  private playbackStartMs = 0;
  private currentMessageIdx = 0;
  private messages: RecordedMessage[] = [];
  private messageHandler: ((address: string, args: unknown[]) => void) | null =
    null;

  /**
   * Load a recording from file.
   */
  loadRecording(filepath: string): void {
    const json = fs.readFileSync(filepath, "utf-8");
    const data = JSON.parse(json) as { messages: RecordedMessage[] };
    this.messages = data.messages;
    this.currentMessageIdx = 0;
    console.log(`Loaded ${this.messages.length} messages from ${filepath}`);
  }

  /**
   * Set the message callback.
   */
  onMessage(handler: (address: string, args: unknown[]) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Start playback.
   */
  play(): void {
    if (this.playing) {
      console.warn("Playback already in progress");
      return;
    }

    if (this.messages.length === 0) {
      console.warn("No messages loaded");
      return;
    }

    this.playing = true;
    this.playbackStartMs = Date.now();
    this.currentMessageIdx = 0;

    console.log(`Playback started, ${this.messages.length} messages`);
    this.playbackLoop();
  }

  /**
   * Stop playback.
   */
  stop(): void {
    this.playing = false;
    console.log("Playback stopped");
  }

  /**
   * Playback loop: check if next message should be sent.
   */
  private playbackLoop(): void {
    if (!this.playing) {
      return;
    }

    const now = Date.now();
    const elapsedMs = now - this.playbackStartMs;

    while (
      this.currentMessageIdx < this.messages.length &&
      this.messages[this.currentMessageIdx].timestampMs <= elapsedMs
    ) {
      const msg = this.messages[this.currentMessageIdx];
      if (this.messageHandler) {
        this.messageHandler(msg.address, msg.args);
      }
      this.currentMessageIdx++;
    }

    if (this.currentMessageIdx >= this.messages.length) {
      this.playing = false;
      console.log("Playback complete");
    } else {
      // Schedule next check
      const nextMsg = this.messages[this.currentMessageIdx];
      const delayMs = Math.max(10, nextMsg.timestampMs - elapsedMs);
      setTimeout(() => this.playbackLoop(), delayMs);
    }
  }

  /**
   * Check if playback is active.
   */
  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Get statistics about current playback.
   */
  getStats(): {
    totalMessages: number;
    processedMessages: number;
    remainingMessages: number;
    isPlaying: boolean;
  } {
    return {
      totalMessages: this.messages.length,
      processedMessages: this.currentMessageIdx,
      remainingMessages:
        this.messages.length - this.currentMessageIdx,
      isPlaying: this.playing,
    };
  }
}
