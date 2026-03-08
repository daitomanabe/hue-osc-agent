/**
 * Structured JSON logger.
 * All events are logged as JSON for easy parsing and analysis.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  subsystem: string;
  event: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private minLevel: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(minLevel: LogLevel = "info") {
    this.minLevel = minLevel;
  }

  /**
   * Log an event at debug level.
   */
  debug(subsystem: string, event: string, data?: Record<string, unknown>): void {
    this.log("debug", subsystem, event, data);
  }

  /**
   * Log an event at info level.
   */
  info(subsystem: string, event: string, data?: Record<string, unknown>): void {
    this.log("info", subsystem, event, data);
  }

  /**
   * Log an event at warn level.
   */
  warn(subsystem: string, event: string, data?: Record<string, unknown>): void {
    this.log("warn", subsystem, event, data);
  }

  /**
   * Log an event at error level.
   */
  error(subsystem: string, event: string, data?: Record<string, unknown>): void {
    this.log("error", subsystem, event, data);
  }

  /**
   * Internal: log with level filtering.
   */
  private log(
    level: LogLevel,
    subsystem: string,
    event: string,
    data?: Record<string, unknown>
  ): void {
    // Filter by log level
    if (this.levels[level] < this.levels[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      subsystem,
      event,
      data,
    };

    console.log(JSON.stringify(entry));
  }
}

/**
 * Global singleton logger instance.
 */
let globalLogger: Logger = new Logger("info");

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getLogger(): Logger {
  return globalLogger;
}
