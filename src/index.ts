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
import { ModeManager } from "./engine/mode_manager.js";

async function main() {
  console.log("=== Hue OSC Agent ===");

  // 1. Load config
  console.log("Loading config...");
  let config;
  try {
    config = loadConfig("CONFIG.yaml");
  } catch (err) {
    console.error("Failed to load config:", err);
    process.exit(1);
  }

  // 2. Initialize state store
  const store = new StateStore();
  console.log("State store initialized");

  // 3. Initialize OSC receiver
  const oscReceiver = new OSCReceiver({
    osc_port: config.runtime.osc_port,
  });

  // 4. Initialize message router
  const messageRouter = new MessageRouter(store, oscReceiver);
  console.log("Message router initialized");

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
  try {
    hueAdapter = new HueAdapter(config as never);
  } catch (err) {
    console.error("Failed to initialize Hue adapter:", err);
    process.exit(1);
  }

  // 10. Validate Entertainment connection
  try {
    await hueAdapter.validate();
    store.setHealth({ entertainmentReady: true });
  } catch (err) {
    console.error("Entertainment validation failed:", err);
    console.log("Continuing in offline mode...");
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
      hueAdapter.sendFrame(fixtureStates).catch((err) => {
        console.error("Frame send error:", err);
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

  // 14. Optional: Start OSC simulator for testing
  const oscSimulator = new OSCSimulator(store);
  if (process.env.SIMULATE_OSC === "1") {
    oscSimulator.start(10);
    console.log("OSC simulator enabled (SIMULATE_OSC=1)");
  }

  // 15. Log initial state
  console.log("\n=== System Ready ===");
  const report = healthMonitor.getReport();
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nFound ${fixtureIds.length} configured fixtures`);
  console.log(`Render rate: ${config.runtime.render_hz} Hz`);
  console.log(`OSC port: ${config.runtime.osc_port}`);
  console.log(`Watchdog timeout: ${config.runtime.watchdog_timeout_ms} ms`);

  // 16. Graceful shutdown on SIGINT
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    oscSimulator.stop();
    renderLoop.stop();
    oscReceiver.stop();
    await hueAdapter.shutdown();
    console.log("Shutdown complete");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
