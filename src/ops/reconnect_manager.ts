/**
 * Reconnect manager: handles automatic recovery from connection failures.
 * Uses exponential backoff with jitter.
 */

import { OutputAdapter } from "../output/base/output_adapter.js";
import { getLogger } from "./logger.js";

export interface ReconnectConfig {
  initialDelayMs: number; // Starting delay
  maxDelayMs: number; // Maximum backoff delay
  jitterMs: number; // Random jitter amount
  maxAttempts: number; // Maximum retry attempts
}

export class ReconnectManager {
  private adapter: OutputAdapter;
  private config: ReconnectConfig;
  private attemptCount = 0;
  private lastFailureMs = 0;
  private isReconnecting = false;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private logger = getLogger();

  constructor(
    adapter: OutputAdapter,
    config: Partial<ReconnectConfig> = {}
  ) {
    this.adapter = adapter;
    this.config = {
      initialDelayMs: config.initialDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      jitterMs: config.jitterMs ?? 500,
      maxAttempts: config.maxAttempts ?? 10,
    };
  }

  /**
   * Handle a connection failure and schedule reconnect.
   */
  async handleFailure(reason: string): Promise<void> {
    this.lastFailureMs = Date.now();

    if (this.isReconnecting) {
      this.logger.debug(
        "reconnect",
        "Already reconnecting, ignoring new failure",
        { reason }
      );
      return;
    }

    if (this.attemptCount >= this.config.maxAttempts) {
      this.logger.error("reconnect", "Max reconnection attempts exceeded", {
        reason,
        attempts: this.attemptCount,
      });
      return;
    }

    this.isReconnecting = true;
    const delayMs = this.calculateBackoffDelay();

    this.logger.warn("reconnect", "Scheduling reconnection attempt", {
      reason,
      attempt: this.attemptCount + 1,
      maxAttempts: this.config.maxAttempts,
      delayMs,
    });

    this.reconnectTimeoutId = setTimeout(() => {
      this.attempt();
    }, delayMs);
  }

  /**
   * Attempt to reconnect.
   */
  private async attempt(): Promise<void> {
    this.attemptCount++;

    this.logger.info("reconnect", "Reconnection attempt", {
      attempt: this.attemptCount,
      maxAttempts: this.config.maxAttempts,
    });

    try {
      await this.adapter.reconnect();
      this.onSuccess();
    } catch (err) {
      await this.onAttemptFailed(err);
    }
  }

  /**
   * Called when reconnection succeeds.
   */
  private onSuccess(): void {
    this.logger.info("reconnect", "Reconnection successful", {
      attempts: this.attemptCount,
      durationMs: Date.now() - this.lastFailureMs,
    });

    this.resetState();
  }

  /**
   * Called when a reconnection attempt fails.
   */
  private async onAttemptFailed(err: unknown): Promise<void> {
    this.logger.warn("reconnect", "Reconnection attempt failed", {
      attempt: this.attemptCount,
      error: String(err),
    });

    if (this.attemptCount < this.config.maxAttempts) {
      await this.handleFailure("reconnect_attempt_failed");
    } else {
      this.logger.error("reconnect", "All reconnection attempts exhausted", {
        attempts: this.attemptCount,
      });
      this.resetState();
    }
  }

  /**
   * Calculate exponential backoff with jitter.
   */
  private calculateBackoffDelay(): number {
    const exponentialDelay = Math.min(
      this.config.initialDelayMs * Math.pow(2, this.attemptCount - 1),
      this.config.maxDelayMs
    );

    const jitter =
      Math.random() * this.config.jitterMs - this.config.jitterMs / 2;

    return Math.max(100, exponentialDelay + jitter);
  }

  /**
   * Reset reconnection state.
   */
  private resetState(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    this.isReconnecting = false;
    this.attemptCount = 0;
  }

  /**
   * Manually reset retry counter (e.g., after manual reconnection success).
   */
  reset(): void {
    this.resetState();
  }

  /**
   * Check if currently in reconnection process.
   */
  isAttemptingReconnect(): boolean {
    return this.isReconnecting;
  }

  /**
   * Graceful shutdown.
   */
  shutdown(): void {
    this.resetState();
  }
}
