/**
 * Configuration loader: reads and validates config from YAML.
 */

import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { AppConfig, ResolvedAppConfig } from "./types.js";

export function loadConfig(filePath: string): ResolvedAppConfig {
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

  const outputBackendEnv = process.env.OUTPUT_BACKEND;
  const outputBackend =
    outputBackendEnv === "hue" || outputBackendEnv === "simulator"
      ? outputBackendEnv
      : config.runtime.output_backend ?? "hue";
  const simulatorPort = Number(
    process.env.SIMULATOR_HTTP_PORT ?? config.simulator?.http_port ?? 9123
  );
  if (!Number.isFinite(simulatorPort) || simulatorPort <= 0) {
    throw new Error("SIMULATOR_HTTP_PORT must resolve to a positive number");
  }
  const webUiPort = Number(
    process.env.WEB_UI_PORT ?? config.web_ui?.http_port ?? 9130
  );
  if (!Number.isFinite(webUiPort) || webUiPort <= 0) {
    throw new Error("WEB_UI_PORT must resolve to a positive number");
  }

  // Resolve app key from environment
  const appKeyEnvName = config.bridge.app_key_env;
  const appKey =
    process.env[appKeyEnvName] ??
    (outputBackend === "simulator" ? "simulator-app-key" : undefined);
  if (!appKey) {
    throw new Error(
      `App key not found in environment variable: ${appKeyEnvName}`
    );
  }

  return {
    ...config,
    bridge: {
      ...config.bridge,
      app_key: appKey,
      allow_self_signed_cert: config.bridge.allow_self_signed_cert ?? true,
      request_timeout_ms: config.bridge.request_timeout_ms ?? 5000,
    },
    runtime: {
      ...config.runtime,
      rest_fallback_hz: config.runtime.rest_fallback_hz ?? 4,
      output_backend: outputBackend,
    },
    simulator: {
      bind_host: process.env.SIMULATOR_BIND_HOST ?? config.simulator?.bind_host ?? "127.0.0.1",
      http_port: simulatorPort,
      title: process.env.SIMULATOR_TITLE ?? config.simulator?.title ?? "Hue OSC Agent Simulator",
    },
    web_ui: {
      enabled:
        process.env.DISABLE_WEB_UI === "1"
          ? false
          : config.web_ui?.enabled ?? true,
      bind_host: process.env.WEB_UI_BIND_HOST ?? config.web_ui?.bind_host ?? "127.0.0.1",
      http_port: webUiPort,
      title: process.env.WEB_UI_TITLE ?? config.web_ui?.title ?? "Hue OSC Agent Control",
    },
  };
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
  if (
    bridge.allow_self_signed_cert !== undefined &&
    typeof bridge.allow_self_signed_cert !== "boolean"
  ) {
    throw new Error("bridge.allow_self_signed_cert must be a boolean");
  }
  if (
    bridge.request_timeout_ms !== undefined &&
    (typeof bridge.request_timeout_ms !== "number" || bridge.request_timeout_ms <= 0)
  ) {
    throw new Error("bridge.request_timeout_ms must be a positive number");
  }

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
  if (
    runtime.rest_fallback_hz !== undefined &&
    (typeof runtime.rest_fallback_hz !== "number" || runtime.rest_fallback_hz <= 0)
  ) {
    throw new Error("runtime.rest_fallback_hz must be a positive number");
  }
  if (
    runtime.output_backend !== undefined &&
    !["hue", "simulator"].includes(runtime.output_backend as string)
  ) {
    throw new Error("runtime.output_backend must be one of: hue, simulator");
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

  // Validate fixtures
  const fixtures = c.fixtures as Record<string, unknown>;
  if (
    !fixtures.phase_offsets ||
    typeof fixtures.phase_offsets !== "object" ||
    Array.isArray(fixtures.phase_offsets)
  ) {
    throw new Error("fixtures.phase_offsets must be an object");
  }
  Object.entries(fixtures.phase_offsets as Record<string, unknown>).forEach(
    ([fixtureId, offset]) => {
      if (typeof offset !== "number") {
        throw new Error(`fixtures.phase_offsets.${fixtureId} must be a number`);
      }
    }
  );
  if (
    fixtures.light_ids !== undefined &&
    (typeof fixtures.light_ids !== "object" || Array.isArray(fixtures.light_ids))
  ) {
    throw new Error("fixtures.light_ids must be an object when provided");
  }

  if (c.simulator !== undefined) {
    const simulator = c.simulator as Record<string, unknown>;
    if (
      simulator.bind_host !== undefined &&
      typeof simulator.bind_host !== "string"
    ) {
      throw new Error("simulator.bind_host must be a string");
    }
    if (
      simulator.http_port !== undefined &&
      (typeof simulator.http_port !== "number" || simulator.http_port <= 0)
    ) {
      throw new Error("simulator.http_port must be a positive number");
    }
    if (
      simulator.title !== undefined &&
      typeof simulator.title !== "string"
    ) {
      throw new Error("simulator.title must be a string");
    }
  }

  if (c.web_ui !== undefined) {
    const webUi = c.web_ui as Record<string, unknown>;
    if (
      webUi.enabled !== undefined &&
      typeof webUi.enabled !== "boolean"
    ) {
      throw new Error("web_ui.enabled must be a boolean");
    }
    if (
      webUi.bind_host !== undefined &&
      typeof webUi.bind_host !== "string"
    ) {
      throw new Error("web_ui.bind_host must be a string");
    }
    if (
      webUi.http_port !== undefined &&
      (typeof webUi.http_port !== "number" || webUi.http_port <= 0)
    ) {
      throw new Error("web_ui.http_port must be a positive number");
    }
    if (
      webUi.title !== undefined &&
      typeof webUi.title !== "string"
    ) {
      throw new Error("web_ui.title must be a string");
    }
  }
}
