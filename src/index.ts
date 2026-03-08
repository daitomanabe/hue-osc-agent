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
import { RestClient } from "./output/hue/rest_client.js";
import { HealthMonitor } from "./ops/health.js";
import { Watchdog } from "./ops/watchdog.js";
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

  // 8. Initialize REST client for admin ops
  let restClient: RestClient;
  let devices = [];
  let areas = [];
  try {
    restClient = new RestClient(config.bridge as never);
    console.log("Validating bridge connection...");
    const connected = await restClient.testConnection();
    if (connected) {
      console.log("Bridge reachable");
      store.setHealth({ bridgeReachable: true });

      // Fetch device inventory
      devices = await restClient.getLights();
      console.log(`Found ${devices.length} lights`);

      // Fetch entertainment areas
      areas = await restClient.getEntertainmentAreas();
      console.log(`Found ${areas.length} entertainment areas`);

      // Verify configured area exists
      const configuredArea = config.bridge.entertainment_area_id;
      const areaExists = areas.some((a) => a.id === configuredArea);
      if (areaExists) {
        console.log(`Entertainment area '${configuredArea}' verified`);
        store.setHealth({ entertainmentReady: true });
      } else {
        console.warn(
          `Configured area '${configuredArea}' not found on bridge`
        );
      }
    }
  } catch (err) {
    console.error("Bridge validation failed:", err);
  }

  // 9. Initialize output adapter
  let hueAdapter: HueAdapter;
  let reconnectManager: ReconnectManager;
  try {
    hueAdapter = new HueAdapter(config as never);
    reconnectManager = new ReconnectManager(hueAdapter, {
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      maxAttempts: 10,
    });
    logger.debug("system", "Hue adapter initialized");
  } catch (err) {
    logger.error("hue", "Failed to initialize Hue adapter", { error: String(err) });
    process.exit(1);
  }

  // 10. Validate Entertainment connection
  try {
    logger.info("hue", "Validating Entertainment connection");
    await hueAdapter.validate();
    store.setHealth({ entertainmentReady: true });
    logger.info("hue", "Entertainment connection validated");
  } catch (err) {
    logger.warn("hue", "Entertainment validation failed", { error: String(err) });
    logger.info("system", "Continuing in offline mode");
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
    if (hueAdapter.isConnected()) {
      hueAdapter.sendFrame(fixtureStates).catch(async (err) => {
        logger.error("hue", "Frame send failed", { error: String(err) });
        store.setHealth({ entertainmentReady: false });

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
          const value = typeof args[0] === "number" ? args[0] : 0;
          messageRouter.recordAudioFeature(feature as any, value);
        } else if (address.startsWith("/event/")) {
          const event = address.split("/")[2];
          messageRouter.recordEvent(event as any);
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
    await hueAdapter.shutdown();
    logger.info("system", "Shutdown complete");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
