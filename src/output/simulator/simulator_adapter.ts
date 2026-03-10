/**
 * Simulator adapter: renders frames to a local HTTP visualizer instead of Hue.
 * Useful for offline development when the bridge and fixtures are unavailable.
 */

import http from "http";
import { ObservableOutputAdapter } from "../base/output_adapter.js";
import { ResolvedFixtureState } from "../../state/types.js";
import { ResolvedAppConfig } from "../../config/types.js";

interface SimulatorFixtureSnapshot extends ResolvedFixtureState {
  cssColor: string;
  hexColor: string;
}

export class SimulatorAdapter implements ObservableOutputAdapter {
  private server: http.Server | null = null;
  private connected = false;
  private frameCount = 0;
  private lastFrameAt = 0;
  private latestFixtures: SimulatorFixtureSnapshot[] = [];
  private startTimeMs = Date.now();

  constructor(private config: ResolvedAppConfig) {}

  async validate(): Promise<void> {
    if (this.connected && this.server) {
      return;
    }

    await this.startServer();
    this.connected = true;
  }

  async sendFrame(
    fixtureStates: Map<string, ResolvedFixtureState>
  ): Promise<void> {
    this.latestFixtures = Array.from(fixtureStates.values())
      .map((fixtureState) => this.toSnapshot(fixtureState))
      .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
    this.frameCount++;
    this.lastFrameAt = Date.now();
  }

  async reconnect(): Promise<void> {
    await this.shutdown();
    await this.validate();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async shutdown(): Promise<void> {
    if (!this.server) {
      this.connected = false;
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
    this.connected = false;
  }

  getStatus(): Record<string, unknown> {
    return {
      backend: "simulator",
      url: `http://${this.config.simulator.bind_host}:${this.config.simulator.http_port}/`,
      fixtureCount: this.latestFixtures.length,
      frameCount: this.frameCount,
      uptimeMs: Date.now() - this.startTimeMs,
      lastFrameAt: this.lastFrameAt || null,
    };
  }

  private async startServer(): Promise<void> {
    this.server = http.createServer((request, response) => {
      if (!request.url) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Missing URL");
        return;
      }

      const url = new URL(request.url, "http://localhost");

      if (url.pathname === "/api/state") {
        this.writeJson(response, {
          title: this.config.simulator.title,
          frameCount: this.frameCount,
          lastFrameAt: this.lastFrameAt || null,
          renderHz: this.config.runtime.render_hz,
          oscPort: this.config.runtime.osc_port,
          fixtureCount: this.latestFixtures.length,
          fixtures: this.latestFixtures,
        });
        return;
      }

      if (url.pathname === "/api/health") {
        this.writeJson(response, {
          ok: true,
          backend: "simulator",
          connected: this.connected,
        });
        return;
      }

      if (url.pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(this.renderHtml());
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(
        this.config.simulator.http_port,
        this.config.simulator.bind_host,
        () => {
          this.server?.off("error", reject);
          resolve();
        }
      );
    });
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

  private toSnapshot(
    fixtureState: ResolvedFixtureState
  ): SimulatorFixtureSnapshot {
    const rgb = this.hsvToRgb(
      fixtureState.hue,
      fixtureState.saturation,
      fixtureState.brightness
    );

    return {
      ...fixtureState,
      cssColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      hexColor: this.rgbToHex(rgb.r, rgb.g, rgb.b),
    };
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
    const title = this.config.simulator.title;

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        --bg: #0c1118;
        --panel: rgba(14, 22, 33, 0.82);
        --panel-border: rgba(137, 180, 255, 0.16);
        --text: #eff4fb;
        --muted: #9eb2c7;
        --accent: #8fd3ff;
        --accent-2: #ffd580;
        --shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(81, 145, 255, 0.18), transparent 34%),
          radial-gradient(circle at top right, rgba(0, 220, 190, 0.12), transparent 26%),
          linear-gradient(180deg, #111926 0%, #090d13 100%);
      }

      .shell {
        width: min(1220px, calc(100vw - 32px));
        margin: 24px auto 40px;
      }

      .hero {
        display: grid;
        gap: 16px;
        margin-bottom: 20px;
      }

      .hero-card,
      .fixture {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(20px);
      }

      .hero-card {
        padding: 24px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 0.95;
        letter-spacing: -0.03em;
      }

      .subline {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 18px;
        color: var(--muted);
        font-size: 14px;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-top: 20px;
      }

      .metric {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .metric-label {
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .metric-value {
        font-size: 22px;
        line-height: 1;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }

      .fixture {
        overflow: hidden;
        position: relative;
      }

      .fixture::before {
        content: "";
        position: absolute;
        inset: 0;
        opacity: 0.24;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.14), transparent 60%);
        pointer-events: none;
      }

      .fixture-top {
        display: grid;
        grid-template-columns: 64px 1fr;
        gap: 14px;
        align-items: center;
        padding: 18px 18px 0;
      }

      .orb {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.18);
        box-shadow:
          0 0 0 8px rgba(255, 255, 255, 0.03),
          inset 0 0 20px rgba(255, 255, 255, 0.18),
          0 12px 28px rgba(0, 0, 0, 0.24);
      }

      .fixture-name {
        font-size: 16px;
        font-weight: 600;
      }

      .fixture-hex {
        margin-top: 4px;
        color: var(--muted);
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 12px;
      }

      .bars {
        padding: 18px;
        display: grid;
        gap: 10px;
      }

      .bar-row {
        display: grid;
        grid-template-columns: 72px 1fr 48px;
        gap: 10px;
        align-items: center;
        font-size: 12px;
      }

      .bar-label {
        color: var(--muted);
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .bar-track {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
      }

      .bar-fill {
        height: 100%;
        border-radius: inherit;
      }

      .empty {
        padding: 48px 24px;
        text-align: center;
        color: var(--muted);
        border: 1px dashed rgba(255, 255, 255, 0.12);
        border-radius: 24px;
      }

      @media (max-width: 720px) {
        .fixture-top {
          grid-template-columns: 52px 1fr;
        }

        .orb {
          width: 52px;
          height: 52px;
        }

        .bar-row {
          grid-template-columns: 62px 1fr 40px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <article class="hero-card">
          <h1>${title}</h1>
          <div class="subline">
            <span>Offline visual output backend</span>
            <span>OSC port <strong id="osc-port">-</strong></span>
            <span>Render <strong id="render-hz">-</strong> Hz</span>
            <span>Last frame <strong id="last-frame">-</strong></span>
          </div>
          <div class="metrics">
            <div class="metric">
              <div class="metric-label">Frames</div>
              <div class="metric-value" id="frame-count">0</div>
            </div>
            <div class="metric">
              <div class="metric-label">Fixtures</div>
              <div class="metric-value" id="fixture-count">0</div>
            </div>
            <div class="metric">
              <div class="metric-label">Backend</div>
              <div class="metric-value">SIM</div>
            </div>
          </div>
        </article>
      </section>
      <section id="fixture-grid" class="grid"></section>
    </main>
    <script>
      const fixtureGrid = document.getElementById("fixture-grid");
      const frameCount = document.getElementById("frame-count");
      const fixtureCount = document.getElementById("fixture-count");
      const renderHz = document.getElementById("render-hz");
      const oscPort = document.getElementById("osc-port");
      const lastFrame = document.getElementById("last-frame");

      function pct(value, max = 1) {
        return Math.round((value / max) * 100);
      }

      function renderFixtureCard(fixture) {
        return \`
          <article class="fixture">
            <div class="fixture-top">
              <div class="orb" style="background: radial-gradient(circle at 30% 25%, rgba(255,255,255,0.85), \${fixture.cssColor} 38%, rgba(0,0,0,0.35) 100%);"></div>
              <div>
                <div class="fixture-name">\${fixture.fixtureId}</div>
                <div class="fixture-hex">\${fixture.hexColor}</div>
              </div>
            </div>
            <div class="bars">
              <div class="bar-row">
                <div class="bar-label">Bright</div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: \${pct(fixture.brightness)}%; background: linear-gradient(90deg, rgba(255,213,128,0.5), rgba(255,246,206,0.95));"></div>
                </div>
                <div>\${pct(fixture.brightness)}%</div>
              </div>
              <div class="bar-row">
                <div class="bar-label">Hue</div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: \${pct(fixture.hue, 360)}%; background: linear-gradient(90deg, #ff6b6b, #ffd93d, #3ddc97, #42a5f5, #9c6bff);"></div>
                </div>
                <div>\${Math.round(fixture.hue)}°</div>
              </div>
              <div class="bar-row">
                <div class="bar-label">Sat</div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: \${pct(fixture.saturation)}%; background: linear-gradient(90deg, rgba(143,211,255,0.35), rgba(143,211,255,0.95));"></div>
                </div>
                <div>\${pct(fixture.saturation)}%</div>
              </div>
            </div>
          </article>
        \`;
      }

      async function refresh() {
        try {
          const response = await fetch("/api/state", { cache: "no-store" });
          const state = await response.json();

          frameCount.textContent = String(state.frameCount);
          fixtureCount.textContent = String(state.fixtureCount);
          renderHz.textContent = String(state.renderHz);
          oscPort.textContent = String(state.oscPort);
          lastFrame.textContent = state.lastFrameAt
            ? new Date(state.lastFrameAt).toLocaleTimeString()
            : "waiting";

          if (!state.fixtures.length) {
            fixtureGrid.innerHTML = '<div class="empty">No frames yet. Start the engine and send OSC, or use <code>SIMULATE_OSC=1</code>.</div>';
            return;
          }

          fixtureGrid.innerHTML = state.fixtures.map(renderFixtureCard).join("");
        } catch (error) {
          fixtureGrid.innerHTML = '<div class="empty">Failed to reach simulator state endpoint.</div>';
        }
      }

      refresh();
      setInterval(refresh, 120);
    </script>
  </body>
</html>`;
  }
}
