/**
 * Main entry point for the Hue OSC Agent.
 */

import { loadConfig } from "./config/load_config.js";
import { StateStore } from "./state/store.js";
import { OSCReceiver } from "./input/osc_receiver.js";
import { MessageRouter } from "./input/message_router.js";
import { RenderLoop } from "./engine/render_loop.js";
import { PriorityResolver } from "./engine/priority_resolver.js";
import { HueAdapter } from "./output/hue/hue_adapter.js";
import { SimulatorAdapter } from "./output/simulator/simulator_adapter.js";
import { ObservableOutputAdapter, OutputAdapter } from "./output/base/output_adapter.js";
import { HealthMonitor } from "./ops/health.js";
import { Watchdog } from "./ops/watchdog.js";
import { ControlWebUI } from "./ops/web_ui.js";
import { OSCSimulator } from "./tools/osc_simulator.js";
import { OSCRecorder, OSCReplayer } from "./tools/osc_replay.js";
import { ModeManager } from "./engine/mode_manager.js";
import { Logger, setGlobalLogger } from "./ops/logger.js";
import { ReconnectManager } from "./ops/reconnect_manager.js";

async function main() {
  console.log("=== Hue OSC Agent ===\n");

  // 0. Initialize logging
  const logger = new Logger(process.env.LOG_LEVEL as any ?? "info");
  setGlobalLogger(logger);
  logger.info("system", "Startup beginning");

  // 1. Load config
  logger.info("config", "Loading configuration");
  let config;
  try {
    config = loadConfig("CONFIG.yaml");
    logger.info("config", "Configuration loaded successfully");
  } catch (err) {
    logger.error("config", "Failed to load config", { error: String(err) });
    process.exit(1);
  }

  // 2. Initialize state store
  const store = new StateStore();
  logger.debug("system", "State store initialized");

  // 3. Initialize OSC receiver
  const oscReceiver = new OSCReceiver({
    osc_port: config.runtime.osc_port,
  });
  logger.debug("system", "OSC receiver created");

  // 4. Initialize message router
  const messageRouter = new MessageRouter(store, oscReceiver);
  logger.debug("system", "Message router initialized");

  // 5. Initialize render loop
  const renderLoop = new RenderLoop(store, config.runtime.render_hz);

  // 5.5 Initialize mode manager
  const modeManager = new ModeManager(store, config);
  console.log("Mode manager initialized with generators");

  // 6. Initialize priority resolver
  const priorityResolver = new PriorityResolver(store, config, modeManager);

  // 7. Initialize health monitor and watchdog
  const healthMonitor = new HealthMonitor(
    store,
    config.runtime.watchdog_timeout_ms
  );
  const watchdog = new Watchdog(store, config.runtime.watchdog_timeout_ms);

  // 8. Initialize output adapter
  let outputAdapter: OutputAdapter;
  let reconnectManager: ReconnectManager;
  const outputBackend = config.runtime.output_backend;
  try {
    outputAdapter =
      outputBackend === "simulator"
        ? new SimulatorAdapter(config)
        : new HueAdapter(config);
    reconnectManager = new ReconnectManager(outputAdapter, {
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      maxAttempts: 10,
    });
    logger.debug("system", "Output adapter initialized", { outputBackend });
  } catch (err) {
    logger.error("output", "Failed to initialize output adapter", {
      error: String(err),
      outputBackend,
    });
    process.exit(1);
  }

  const observableAdapter = outputAdapter as ObservableOutputAdapter;
  let lastOutputHealth = {
    bridgeReachable: false,
    entertainmentReady: false,
  };
  const getAdapterStatus = (): Record<string, unknown> =>
    typeof observableAdapter.getStatus === "function"
      ? observableAdapter.getStatus()
      : { backend: outputBackend };
  const getOutputStatus = (): Record<string, unknown> => ({
    backend: outputBackend,
    ...getAdapterStatus(),
  });
  const syncOutputHealth = (): Record<string, unknown> => {
    if (outputBackend === "simulator") {
      if (
        !lastOutputHealth.bridgeReachable ||
        !lastOutputHealth.entertainmentReady
      ) {
        store.setHealth({
          bridgeReachable: true,
          entertainmentReady: true,
        });
        lastOutputHealth = {
          bridgeReachable: true,
          entertainmentReady: true,
        };
      }
      return getOutputStatus();
    }

    const status = getOutputStatus() as {
      bridgeReachable?: boolean;
      entertainmentConnected?: boolean;
      restFallbackReady?: boolean;
    };
    const bridgeReachable = Boolean(status.bridgeReachable);
    const entertainmentReady = Boolean(
      status.entertainmentConnected || status.restFallbackReady
    );

    if (
      bridgeReachable !== lastOutputHealth.bridgeReachable ||
      entertainmentReady !== lastOutputHealth.entertainmentReady
    ) {
      store.setHealth({
        bridgeReachable,
        entertainmentReady,
      });
      lastOutputHealth = {
        bridgeReachable,
        entertainmentReady,
      };
    }

    return status;
  };

  // 9. Validate Hue transport
  try {
    logger.info("output", "Validating output transport", { outputBackend });
    await outputAdapter.validate();
    const transportStatus = syncOutputHealth();
    logger.info("output", "Output transport validated", {
      outputBackend,
      ...transportStatus,
    });
    if (
      outputBackend === "hue" &&
      !(transportStatus as { entertainmentConnected?: boolean }).entertainmentConnected
    ) {
      logger.warn("hue", "Entertainment unavailable, REST fallback enabled", transportStatus);
    }
  } catch (err) {
    logger.error("output", "Output transport validation failed", {
      error: String(err),
      outputBackend,
    });
    process.exit(1);
  }

  // 10. Start control WebUI
  let controlWebUi: ControlWebUI | null = null;
  if (config.web_ui.enabled) {
    try {
      controlWebUi = new ControlWebUI(store, config, getOutputStatus);
      await controlWebUi.start();
      logger.info("ops", "Control WebUI started", controlWebUi.getStatus());
    } catch (err) {
      logger.error("ops", "Failed to start control WebUI", {
        error: String(err),
      });
      process.exit(1);
    }
  }

  // 11. Setup render loop callback
  const fixtureIds = Object.keys(config.fixtures.phase_offsets);
  let lastRenderMs = Date.now();

  renderLoop.onRender(() => {
    const now = Date.now();
    const deltaMs = now - lastRenderMs;
    lastRenderMs = now;

    // Update priority resolver with delta time
    priorityResolver.setDeltaMs(deltaMs);

    // Run watchdog check
    watchdog.tick();
    healthMonitor.check();

    // Resolve fixture states through priority stack
    const fixtureStates = priorityResolver.resolve(fixtureIds);
    store.setFixtureStates(fixtureStates);

    // Send to output adapter
    if (outputAdapter.isConnected()) {
      outputAdapter
        .sendFrame(fixtureStates)
        .then(() => {
          syncOutputHealth();
        })
        .catch(async (err) => {
          logger.error("output", "Frame send failed", {
            error: String(err),
            outputBackend,
          });
          syncOutputHealth();

          // Attempt reconnection if not already trying
          if (!reconnectManager.isAttemptingReconnect()) {
            await reconnectManager.handleFailure("frame_send_failed");
          }
        });
    }

    // Clear event flags after consumption
    store.clearEvents();
  });

  // 12. Start OSC receiver
  try {
    await oscReceiver.start();
  } catch (err) {
    console.error("Failed to start OSC receiver:", err);
    process.exit(1);
  }

  // 13. Start render loop
  renderLoop.start();

  // 14. Optional: OSC Simulator or Replay
  const oscSimulator = new OSCSimulator(store);
  const oscRecorder = new OSCRecorder();
  const oscReplayer = new OSCReplayer();

  if (process.env.SIMULATE_OSC === "1") {
    oscSimulator.start(10);
    logger.info("tools", "OSC simulator enabled");
  }

  if (process.env.REPLAY_OSC) {
    try {
      oscReplayer.loadRecording(process.env.REPLAY_OSC);
      oscReplayer.onMessage((address, args) => {
        // Simple replay: just handle audio/event messages
        if (address.startsWith("/audio/")) {
          const feature = address.split("/")[2];
          const normalizedFeature =
            (
              {
                lowmid: "lowMid",
                beat_phase: "beatPhase",
              } as Record<string, string>
            )[feature] ?? feature;
          const value = typeof args[0] === "number" ? args[0] : 0;
          messageRouter.recordAudioFeature(normalizedFeature as any, value);
        } else if (address.startsWith("/event/")) {
          const event = address.split("/")[2];
          const normalizedEvent =
            (
              {
                scene_change: "sceneChange",
              } as Record<string, string>
            )[event] ?? event;
          messageRouter.recordEvent(normalizedEvent as any);
        }
      });
      oscReplayer.play();
      logger.info("tools", "OSC replay started", { file: process.env.REPLAY_OSC });
    } catch (err) {
      logger.warn("tools", "Failed to load replay file", { error: String(err) });
    }
  }

  // 15. Log initial state
  console.log("\n=== System Ready ===");
  const report = healthMonitor.getReport();
  logger.info("system", "System ready", {
    fixtures: fixtureIds.length,
    renderHz: config.runtime.render_hz,
    oscPort: config.runtime.osc_port,
    watchdogMs: config.runtime.watchdog_timeout_ms,
    health: report,
    outputBackend,
    output: getOutputStatus(),
    webUi: controlWebUi?.getStatus() ?? { enabled: false },
  });
  console.log(JSON.stringify(report, null, 2));

  // 16. Graceful shutdown on SIGINT
  process.on("SIGINT", async () => {
    logger.info("system", "Shutdown initiated");
    oscSimulator.stop();
    oscReplayer.stop?.();
    renderLoop.stop();
    oscReceiver.stop();
    reconnectManager.shutdown();
    if (controlWebUi) {
      await controlWebUi.stop();
    }
    await outputAdapter.shutdown();
    logger.info("system", "Shutdown complete");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
