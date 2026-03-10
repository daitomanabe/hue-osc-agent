# Quick Start

## One-Command Launch

### macOS / Linux

```bash
./run.sh
```

### Windows (PowerShell)

```powershell
.\run.ps1
```

## What the Script Does

1. ✅ Checks Node.js installation
2. ✅ Installs npm dependencies
3. ✅ Builds TypeScript
4. ✅ Creates CONFIG.yaml if missing
5. ✅ Prompts for HUE_APP_KEY
6. ✅ Shows launch options
7. ✅ Starts the engine

## Prerequisites

### Required
- **Node.js** 18+ ([download](https://nodejs.org/))
- **Philips Hue Bridge** on local network
- **Bridge App Key** (see below)

### Optional
- Text editor (nano, vim, or Notepad)
- OSC source (Ableton, Max, SuperCollider, etc.)

## Getting Your Hue App Key

1. **Power on your Hue Bridge** and confirm it's on the same network as your machine
2. **Find the Bridge IP**:
   ```bash
   # macOS/Linux
   ping hue.local
   # or check your router's device list
   ```
3. **Press the physical Link button** on the bridge (you have 30 seconds)
4. **Create an app key**:

   **macOS/Linux (bash)**:
   ```bash
   BRIDGE_IP="192.168.1.100"  # Replace with your bridge IP
   curl -X POST "https://$BRIDGE_IP/api" \
     -d '{"devicetype": "hue-osc-agent"}' \
     -k --insecure
   ```

   **Windows (PowerShell)**:
   ```powershell
   $bridge_ip = "192.168.1.100"
   $body = @{devicetype = "hue-osc-agent"} | ConvertTo-Json
   curl.exe -X POST "https://$bridge_ip/api" -d $body -k
   ```

5. **Copy the `username` field** from the response
6. **Set the environment variable**:

   **macOS/Linux**:
   ```bash
   export HUE_APP_KEY="<your-username-from-step-5>"
   ./run.sh
   ```

   **Windows (PowerShell)**:
   ```powershell
   $env:HUE_APP_KEY = "<your-username-from-step-5>"
   .\run.ps1
   ```

## Configuration

The script creates `CONFIG.yaml` from `CONFIG.example.yaml`. Edit it to set:

```yaml
bridge:
  ip: 192.168.1.100          # Your bridge IP
  entertainment_area_id: area-1  # From Hue app
  allow_self_signed_cert: true
  request_timeout_ms: 5000

runtime:
  osc_port: 9000             # Listen port for OSC
  render_hz: 60              # Frame rate
  rest_fallback_hz: 4        # Capped REST fallback rate if Entertainment is unavailable

web_ui:
  enabled: true
  http_port: 9130            # Manual light control UI
```

## Testing Without Hardware

```bash
# Offline simulator (generates synthetic OSC)
SIMULATE_OSC=1 ./run.sh

# Replay a recorded session
REPLAY_OSC=sessions/my-session.json ./run.sh
```

Full visual simulator:

```bash
OUTPUT_BACKEND=simulator SIMULATE_OSC=1 npm start
```

Open:

```text
http://127.0.0.1:9123/
```

Control WebUI:

```text
http://127.0.0.1:9130/
```

This UI writes a manual override into the engine, so you can force hue / saturation / brightness even when OSC is idle. If Entertainment cannot cover all configured fixtures, the engine now stays up in REST fallback mode and the WebUI can still drive the resolved fixture map.
The engine also starts in `floating` mode by default, so you should see a soft moving look immediately after launch.

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `HUE_APP_KEY` | Bridge authentication | (required) |
| `SIMULATE_OSC` | Enable offline simulator | `SIMULATE_OSC=1` |
| `OUTPUT_BACKEND` | Select `hue` or `simulator` | `OUTPUT_BACKEND=simulator` |
| `SIMULATOR_HTTP_PORT` | Override simulator UI port | `SIMULATOR_HTTP_PORT=9300` |
| `SIMULATOR_BIND_HOST` | Override simulator bind host | `SIMULATOR_BIND_HOST=0.0.0.0` |
| `WEB_UI_PORT` | Override control UI port | `WEB_UI_PORT=9131` |
| `WEB_UI_BIND_HOST` | Override control UI bind host | `WEB_UI_BIND_HOST=0.0.0.0` |
| `DISABLE_WEB_UI` | Disable control UI | `DISABLE_WEB_UI=1` |
| `REPLAY_OSC` | Play back recorded session | `REPLAY_OSC=file.json` |
| `LOG_LEVEL` | Logging verbosity | `LOG_LEVEL=debug` |

## Verify It's Working

When the engine starts, you should see:

```json
{
  "timestamp": "2026-03-08T11:30:00.000Z",
  "level": "info",
  "subsystem": "system",
  "event": "System ready",
  "data": {
    "fixtures": 4,
    "renderHz": 60,
    "oscPort": 9000,
    "health": {
      "oscAlive": false,
      "bridgeReachable": true,
      "entertainmentReady": true,
      "fallbackActive": false
    }
  }
}
```

## Troubleshooting

### Node.js not found
- Install Node.js from https://nodejs.org/
- Restart your terminal

### CONFIG.yaml not found
- The script creates it automatically
- Or copy: `cp CONFIG.example.yaml CONFIG.yaml`

### HUE_APP_KEY error
- See "Getting Your Hue App Key" section above
- Or manually: `export HUE_APP_KEY=<key>`

### Bridge not reachable
- Check bridge IP in CONFIG.yaml
- Verify bridge is on same network
- Test: `curl -k https://<bridge-ip>/api`

### Entertainment connection failed
- Verify entertainment area ID in CONFIG.yaml
- Check area contains at least one light
- Confirm lights are powered on
- If Entertainment still cannot start, the engine now falls back to low-frequency REST output

### No lights responding
- Check Hue app to confirm lights are in the entertainment area
- If your logical fixture names are custom, set `fixtures.light_ids` in `CONFIG.yaml`
- Try `/system/safe_ambient` OSC command
- Verify bridge firmware is up to date

### Simulator UI not opening
- Run with `OUTPUT_BACKEND=simulator`
- Check `simulator.http_port` in `CONFIG.yaml`
- Or set `SIMULATOR_HTTP_PORT=<port>`
- Test: `curl http://127.0.0.1:9123/api/health`

### Control WebUI not opening
- Check `web_ui.http_port` in `CONFIG.yaml`
- Or set `WEB_UI_PORT=<port>`
- Test: `curl http://127.0.0.1:9130/api/state`
- Set `DISABLE_WEB_UI=1` only if you intentionally want it off

## Next Steps

1. **Send OSC from your DAW/tool**:
   ```
   Target: localhost:9000
   Messages:
     /audio/rms <0-1>
     /audio/low <0-1>
     /event/kick
     /mode/floating/start
   ```

2. **Start a mode**:
   ```
   /mode/floating/start
   /mode/drift/start
   /mode/underwater/start
   ```

3. **Record a session** (for testing):
   The engine logs all OSC to `osc-session-<timestamp>.json`

See **OPERATING_GUIDE.md** for complete OSC reference.

---

**Status**: Ready to launch! Run `./run.sh` to begin.
