/**
 * Lightweight control WebUI for manual light operation and state inspection.
 */

import http from "http";
import { StateStore } from "../state/store.js";
import { ManualOverride, ResolvedFixtureState } from "../state/types.js";
import { ResolvedAppConfig } from "../config/types.js";

interface UiFixture extends ResolvedFixtureState {
  cssColor: string;
  hexColor: string;
}

export class ControlWebUI {
  private server: http.Server | null = null;

  constructor(
    private store: StateStore,
    private config: ResolvedAppConfig,
    private getOutputStatus: () => Record<string, unknown>
  ) {}

  async start(): Promise<void> {
    if (!this.config.web_ui.enabled || this.server) {
      return;
    }

    this.server = http.createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response);
      } catch (err) {
        response.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: String(err) }));
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(
        this.config.web_ui.http_port,
        this.config.web_ui.bind_host,
        () => {
          this.server?.off("error", reject);
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
  }

  getStatus(): Record<string, unknown> {
    return {
      enabled: this.config.web_ui.enabled,
      url: `http://${this.config.web_ui.bind_host}:${this.config.web_ui.http_port}/`,
    };
  }

  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Missing URL");
      return;
    }

    const url = new URL(request.url, "http://localhost");

    if (request.method === "GET" && url.pathname === "/api/state") {
      this.writeJson(response, this.buildStatePayload());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/mode/floating") {
      const body = await this.readJsonBody(request);
      const speed = this.updateFloatingMode(body);
      this.writeJson(response, { ok: true, speed });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/manual-override") {
      const body = await this.readJsonBody(request);
      const override = this.parseManualOverride(body);
      this.store.setManualOverride(override);
      this.writeJson(response, { ok: true, manualOverride: override });
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/manual-override") {
      this.store.clearManualOverride();
      this.writeJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/system/blackout") {
      this.store.setHealth({
        fallbackActive: true,
        fallbackReason: "blackout",
      });
      this.writeJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/system/restore") {
      this.store.setHealth({
        fallbackActive: false,
        fallbackReason: undefined,
      });
      this.writeJson(response, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(this.renderHtml());
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }

  private buildStatePayload(): Record<string, unknown> {
    const state = this.store.getState();

    return {
      title: this.config.web_ui.title,
      runtime: {
        oscPort: this.config.runtime.osc_port,
        renderHz: this.config.runtime.render_hz,
        outputBackend: this.config.runtime.output_backend,
      },
      modeDefaults: {
        floating: this.config.modes.floating,
      },
      health: state.health,
      activeMode: state.activeMode,
      manualOverride: state.manualOverride,
      fixtures: Array.from(state.fixtureStates.values())
        .map((fixture) => this.toUiFixture(fixture))
        .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId)),
      output: this.getOutputStatus(),
    };
  }

  private updateFloatingMode(body: unknown): number {
    const record = body as Record<string, unknown>;
    const speed = this.clamp(Number(record.speed), 0, 1);
    const state = this.store.getState();
    const previousParams =
      state.activeMode.name === "floating" ? state.activeMode.params : {};

    this.store.setActiveMode({
      name: "floating",
      enabled: true,
      startedAtMs:
        state.activeMode.name === "floating" && state.activeMode.enabled
          ? state.activeMode.startedAtMs
          : Date.now(),
      params: {
        ...previousParams,
        speed,
      },
    });

    return speed;
  }

  private parseManualOverride(body: unknown): ManualOverride {
    const record = body as Record<string, unknown>;
    const brightness = this.clamp(Number(record.brightness), 0, 1);
    const saturation = this.clamp(Number(record.saturation), 0, 1);
    const hueRaw = Number(record.hue);
    const hue = Number.isFinite(hueRaw)
      ? ((hueRaw % 360) + 360) % 360
      : 0;

    return {
      enabled: true,
      brightness,
      hue,
      saturation,
      updatedAtMs: Date.now(),
    };
  }

  private toUiFixture(fixture: ResolvedFixtureState): UiFixture {
    const rgb = this.hsvToRgb(fixture.hue, fixture.saturation, fixture.brightness);
    return {
      ...fixture,
      cssColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      hexColor: this.rgbToHex(rgb.r, rgb.g, rgb.b),
    };
  }

  private async readJsonBody(
    request: http.IncomingMessage
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
      return {};
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<
      string,
      unknown
    >;
  }

  private writeJson(
    response: http.ServerResponse,
    payload: Record<string, unknown>
  ): void {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.min(max, Math.max(min, value));
  }

  private hsvToRgb(hueDegrees: number, saturation: number, value: number): {
    r: number;
    g: number;
    b: number;
  } {
    const hue = ((hueDegrees % 360) + 360) % 360;
    const c = value * saturation;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = value - c;

    let red = 0;
    let green = 0;
    let blue = 0;

    if (hue < 60) {
      red = c;
      green = x;
    } else if (hue < 120) {
      red = x;
      green = c;
    } else if (hue < 180) {
      green = c;
      blue = x;
    } else if (hue < 240) {
      green = x;
      blue = c;
    } else if (hue < 300) {
      red = x;
      blue = c;
    } else {
      red = c;
      blue = x;
    }

    return {
      r: Math.round((red + m) * 255),
      g: Math.round((green + m) * 255),
      b: Math.round((blue + m) * 255),
    };
  }

  private rgbToHex(red: number, green: number, blue: number): string {
    return `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  private renderHtml(): string {
    const title = this.config.web_ui.title;

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        --bg: #f3f0e8;
        --panel: rgba(255, 252, 245, 0.82);
        --panel-border: rgba(27, 37, 49, 0.1);
        --text: #14202d;
        --muted: #5f6f7e;
        --accent: #ffb347;
        --accent-2: #007f8c;
        --danger: #9b1c20;
        --shadow: 0 24px 70px rgba(20, 32, 45, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(255, 179, 71, 0.22), transparent 28%),
          radial-gradient(circle at top right, rgba(0, 127, 140, 0.16), transparent 26%),
          linear-gradient(180deg, #f8f5ef 0%, #ece6db 100%);
      }

      .shell {
        width: min(1220px, calc(100vw - 32px));
        margin: 24px auto 40px;
        display: grid;
        gap: 16px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(16px);
      }

      .hero {
        padding: 24px;
        display: grid;
        gap: 18px;
      }

      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 0.95;
        letter-spacing: -0.04em;
      }

      .subline {
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        gap: 8px 18px;
        font-size: 14px;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(280px, 340px) 1fr;
        gap: 16px;
      }

      .controls {
        padding: 22px;
        display: grid;
        gap: 16px;
        align-content: start;
      }

      .control-group {
        display: grid;
        gap: 8px;
      }

      label {
        font-size: 12px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted);
      }

      input[type="color"] {
        width: 100%;
        height: 56px;
        border: none;
        border-radius: 16px;
        background: #fff;
        padding: 6px;
      }

      input[type="range"] {
        width: 100%;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      button {
        border: none;
        border-radius: 16px;
        padding: 14px 16px;
        font: inherit;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease;
      }

      button:hover { transform: translateY(-1px); }

      .primary {
        background: linear-gradient(135deg, var(--accent), #f48c5b);
        color: #1e1308;
      }

      .secondary {
        background: rgba(20, 32, 45, 0.08);
        color: var(--text);
      }

      .danger {
        background: var(--danger);
        color: #fff;
      }

      .status-list {
        display: grid;
        gap: 10px;
      }

      .status-item {
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(20, 32, 45, 0.08);
      }

      .status-label {
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 6px;
      }

      .fixtures {
        padding: 20px;
        display: grid;
        gap: 12px;
      }

      .fixture-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .fixture {
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.55);
        border: 1px solid rgba(20, 32, 45, 0.08);
        display: grid;
        gap: 10px;
      }

      .fixture-head {
        display: grid;
        grid-template-columns: 46px 1fr;
        gap: 12px;
        align-items: center;
      }

      .swatch {
        width: 46px;
        height: 46px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.7);
        box-shadow: inset 0 0 18px rgba(255, 255, 255, 0.3);
      }

      .fixture-name {
        font-weight: 600;
      }

      .fixture-hex {
        color: var(--muted);
        font-family: "IBM Plex Mono", monospace;
        font-size: 12px;
      }

      .metric {
        display: grid;
        grid-template-columns: 56px 1fr 42px;
        gap: 8px;
        align-items: center;
        font-size: 12px;
      }

      .bar {
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(20, 32, 45, 0.08);
      }

      .bar-fill {
        height: 100%;
        border-radius: inherit;
      }

      .empty {
        padding: 40px 20px;
        text-align: center;
        color: var(--muted);
        border-radius: 18px;
        border: 1px dashed rgba(20, 32, 45, 0.14);
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel hero">
        <h1>${title}</h1>
        <div class="subline">
          <span>Manual override control for live Hue output</span>
          <span>OSC <strong id="osc-port">-</strong></span>
          <span>Backend <strong id="backend-name">-</strong></span>
          <span>Mode <strong id="active-mode">-</strong></span>
        </div>
      </section>
      <section class="layout">
        <aside class="panel controls">
          <div class="control-group">
            <label for="color">Color</label>
            <input id="color" type="color" value="#ff8a00" />
          </div>
          <div class="control-group">
            <label for="brightness">Brightness</label>
            <input id="brightness" type="range" min="0" max="100" value="60" />
            <div id="brightness-value">60%</div>
          </div>
          <div class="control-group">
            <label for="floating-speed">Floating Speed</label>
            <input id="floating-speed" type="range" min="0" max="100" value="6" />
            <div id="floating-speed-value">0.06</div>
          </div>
          <div class="actions">
            <button id="apply" class="primary">Apply Color</button>
            <button id="clear" class="secondary">Clear Override</button>
            <button id="blackout" class="danger">Blackout</button>
            <button id="restore" class="secondary">Restore</button>
          </div>
          <div class="status-list">
            <div class="status-item">
              <div class="status-label">Manual Override</div>
              <div id="manual-status">inactive</div>
            </div>
            <div class="status-item">
              <div class="status-label">Transport</div>
              <div id="transport-status">-</div>
            </div>
            <div class="status-item">
              <div class="status-label">Fallback</div>
              <div id="fallback-status">-</div>
            </div>
          </div>
        </aside>
        <section class="panel fixtures">
          <div id="fixture-grid" class="fixture-grid"></div>
        </section>
      </section>
    </main>
    <script>
      const colorInput = document.getElementById("color");
      const brightnessInput = document.getElementById("brightness");
      const brightnessValue = document.getElementById("brightness-value");
      const floatingSpeedInput = document.getElementById("floating-speed");
      const floatingSpeedValue = document.getElementById("floating-speed-value");
      const fixtureGrid = document.getElementById("fixture-grid");
      const oscPort = document.getElementById("osc-port");
      const backendName = document.getElementById("backend-name");
      const activeMode = document.getElementById("active-mode");
      const manualStatus = document.getElementById("manual-status");
      const transportStatus = document.getElementById("transport-status");
      const fallbackStatus = document.getElementById("fallback-status");
      let floatingSpeedTimer = null;

      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      function hexToHsv(hex) {
        const normalized = hex.replace("#", "");
        const bigint = Number.parseInt(normalized, 16);
        const r = ((bigint >> 16) & 255) / 255;
        const g = ((bigint >> 8) & 255) / 255;
        const b = (bigint & 255) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        let hue = 0;

        if (delta !== 0) {
          if (max === r) {
            hue = 60 * (((g - b) / delta) % 6);
          } else if (max === g) {
            hue = 60 * ((b - r) / delta + 2);
          } else {
            hue = 60 * ((r - g) / delta + 4);
          }
        }

        if (hue < 0) hue += 360;

        return {
          hue,
          saturation: max === 0 ? 0 : delta / max,
          brightness: max,
        };
      }

      function pct(value, max = 1) {
        return Math.round((value / max) * 100);
      }

      function formatSpeed(value) {
        return Number(value).toFixed(2);
      }

      async function updateFloatingSpeed(value) {
        await postJson("/api/mode/floating", "POST", {
          speed: clamp(value, 0, 1),
        });
      }

      function renderFixture(fixture) {
        return \`
          <article class="fixture">
            <div class="fixture-head">
              <div class="swatch" style="background: \${fixture.cssColor};"></div>
              <div>
                <div class="fixture-name">\${fixture.fixtureId}</div>
                <div class="fixture-hex">\${fixture.hexColor}</div>
              </div>
            </div>
            <div class="metric">
              <div>Bright</div>
              <div class="bar"><div class="bar-fill" style="width: \${pct(fixture.brightness)}%; background: linear-gradient(90deg, #ffd18a, #fff4d1);"></div></div>
              <div>\${pct(fixture.brightness)}%</div>
            </div>
            <div class="metric">
              <div>Hue</div>
              <div class="bar"><div class="bar-fill" style="width: \${pct(fixture.hue, 360)}%; background: linear-gradient(90deg, #ff5b5b, #ffd93d, #2ad89f, #4aa8ff, #915bff);"></div></div>
              <div>\${Math.round(fixture.hue)}°</div>
            </div>
            <div class="metric">
              <div>Sat</div>
              <div class="bar"><div class="bar-fill" style="width: \${pct(fixture.saturation)}%; background: linear-gradient(90deg, rgba(0,127,140,0.3), rgba(0,127,140,0.95));"></div></div>
              <div>\${pct(fixture.saturation)}%</div>
            </div>
          </article>
        \`;
      }

      async function postJson(url, method, body) {
        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return response.json();
      }

      async function refresh() {
        const response = await fetch("/api/state", { cache: "no-store" });
        const state = await response.json();

        oscPort.textContent = String(state.runtime?.oscPort ?? "-");
        backendName.textContent = state.output?.backend || state.runtime?.outputBackend || "hue";
        activeMode.textContent = state.activeMode?.name || "idle";
        manualStatus.textContent = state.manualOverride?.enabled
          ? \`h=\${Math.round(state.manualOverride.hue)} sat=\${pct(state.manualOverride.saturation)} bri=\${pct(state.manualOverride.brightness)}\`
          : "inactive";
        const floatingSpeed =
          Number(state.activeMode?.name === "floating"
            ? state.activeMode?.params?.speed
            : state.modeDefaults?.floating?.speed);
        if (document.activeElement !== floatingSpeedInput && Number.isFinite(floatingSpeed)) {
          floatingSpeedInput.value = String(Math.round(clamp(floatingSpeed, 0, 1) * 100));
        }
        if (Number.isFinite(floatingSpeed)) {
          floatingSpeedValue.textContent = formatSpeed(clamp(floatingSpeed, 0, 1));
        }
        transportStatus.textContent = state.output?.transportMode
          ? \`\${state.output.transportMode}\${state.output.entertainmentSkippedReason ? " | " + state.output.entertainmentSkippedReason : ""}\`
          : JSON.stringify(state.output || {});
        fallbackStatus.textContent = state.health?.fallbackActive
          ? state.health?.fallbackReason || "active"
          : "inactive";

        if (!state.fixtures.length) {
          fixtureGrid.innerHTML = '<div class="empty">No resolved fixture state yet. The engine will populate this after the first render tick.</div>';
          return;
        }

        fixtureGrid.innerHTML = state.fixtures.map(renderFixture).join("");
      }

      brightnessInput.addEventListener("input", () => {
        brightnessValue.textContent = brightnessInput.value + "%";
      });

      floatingSpeedInput.addEventListener("input", () => {
        const speed = clamp(Number(floatingSpeedInput.value) / 100, 0, 1);
        floatingSpeedValue.textContent = formatSpeed(speed);
        if (floatingSpeedTimer) {
          clearTimeout(floatingSpeedTimer);
        }
        floatingSpeedTimer = setTimeout(() => {
          updateFloatingSpeed(speed).catch(console.error);
        }, 120);
      });

      floatingSpeedInput.addEventListener("change", async () => {
        const speed = clamp(Number(floatingSpeedInput.value) / 100, 0, 1);
        floatingSpeedValue.textContent = formatSpeed(speed);
        if (floatingSpeedTimer) {
          clearTimeout(floatingSpeedTimer);
          floatingSpeedTimer = null;
        }
        await updateFloatingSpeed(speed);
        await refresh();
      });

      document.getElementById("apply").addEventListener("click", async () => {
        const hsv = hexToHsv(colorInput.value);
        await postJson("/api/manual-override", "POST", {
          hue: hsv.hue,
          saturation: hsv.saturation,
          brightness: clamp(Number(brightnessInput.value) / 100, 0, 1),
        });
        await refresh();
      });

      document.getElementById("clear").addEventListener("click", async () => {
        await fetch("/api/manual-override", { method: "DELETE" });
        await refresh();
      });

      document.getElementById("blackout").addEventListener("click", async () => {
        await postJson("/api/system/blackout", "POST");
        await refresh();
      });

      document.getElementById("restore").addEventListener("click", async () => {
        await postJson("/api/system/restore", "POST");
        await refresh();
      });

      refresh();
      setInterval(refresh, 250);
    </script>
  </body>
</html>`;
  }
}
