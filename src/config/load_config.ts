/**
 * Configuration loader: reads and validates config from YAML.
 */

import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { AppConfig } from "./types.js";

export function loadConfig(filePath: string): AppConfig {
  // Resolve relative paths
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const config = parse(content) as AppConfig;

  validateConfig(config);

  // Resolve app key from environment
  const appKeyEnvName = config.bridge.app_key_env;
  const appKey = process.env[appKeyEnvName];
  if (!appKey) {
    throw new Error(
      `App key not found in environment variable: ${appKeyEnvName}`
    );
  }

  // Inject resolved app key into bridge config
  (config.bridge as unknown as Record<string, unknown>).app_key = appKey;

  return config;
}

export function validateConfig(config: unknown): asserts config is AppConfig {
  const c = config as Record<string, unknown>;

  if (!c.bridge) throw new Error("Missing bridge config");
  if (!c.runtime) throw new Error("Missing runtime config");
  if (!c.safe_ambient) throw new Error("Missing safe_ambient config");
  if (!c.modes) throw new Error("Missing modes config");
  if (!c.audio_mapping) throw new Error("Missing audio_mapping config");
  if (!c.fixtures) throw new Error("Missing fixtures config");

  // Validate bridge
  const bridge = c.bridge as Record<string, unknown>;
  if (!bridge.ip || typeof bridge.ip !== "string")
    throw new Error("bridge.ip must be a string");
  if (!bridge.app_key_env || typeof bridge.app_key_env !== "string")
    throw new Error("bridge.app_key_env must be a string");
  if (!bridge.entertainment_area_id || typeof bridge.entertainment_area_id !== "string")
    throw new Error("bridge.entertainment_area_id must be a string");

  // Validate runtime
  const runtime = c.runtime as Record<string, unknown>;
  if (typeof runtime.render_hz !== "number" || runtime.render_hz <= 0)
    throw new Error("runtime.render_hz must be a positive number");
  if (typeof runtime.osc_port !== "number" || runtime.osc_port <= 0)
    throw new Error("runtime.osc_port must be a positive number");
  if (typeof runtime.watchdog_timeout_ms !== "number" || runtime.watchdog_timeout_ms <= 0)
    throw new Error("runtime.watchdog_timeout_ms must be a positive number");
  if (
    runtime.log_level &&
    !["debug", "info", "warn", "error"].includes(runtime.log_level as string)
  ) {
    throw new Error("runtime.log_level must be one of: debug, info, warn, error");
  }

  // Validate safe_ambient
  const safeAmbient = c.safe_ambient as Record<string, unknown>;
  if (typeof safeAmbient.brightness !== "number" || safeAmbient.brightness < 0 || safeAmbient.brightness > 1)
    throw new Error("safe_ambient.brightness must be between 0 and 1");

  // Validate audio_mapping
  const audioMapping = c.audio_mapping as Record<string, unknown>;
  ["rms_to_brightness", "low_to_depth", "high_to_sparkle", "centroid_to_palette_shift"].forEach(
    (key) => {
      if (typeof audioMapping[key] !== "number" || audioMapping[key] < 0)
        throw new Error(`audio_mapping.${key} must be a non-negative number`);
    }
  );
}
