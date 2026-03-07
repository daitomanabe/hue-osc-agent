# Operating Guide

## Quick Start

### 1. Prerequisites
- Node.js 18+
- Philips Hue Bridge on local network
- Bridge app key (obtain via local API authorization)
- Entertainment area configured on bridge

### 2. Installation

```bash
npm install
npm run build
```

### 3. Configuration

Copy the example config and customize:
```bash
cp CONFIG.example.yaml CONFIG.yaml
# Edit CONFIG.yaml with:
# - Bridge IP address
# - Entertainment area ID
# - Fixture phase offsets
# - Mode parameters
```

### 4. Set App Key

Store your Hue app key in environment:
```bash
export HUE_APP_KEY=your-app-key-here
```

### 5. Run

```bash
npm start
```

Or enable OSC simulator for offline testing:
```bash
SIMULATE_OSC=1 npm start
```

## Operational Modes

### 1. Floating
Slow organic drift with noise. Good for ambient fill.
```
/mode/floating/start
```

### 2. Drift
Even slower, minimal motion. For long-form background.
```
/mode/drift/start
```

### 3. Candle
Warm ambient with flicker. Intimate feel.
```
/mode/candle/start
```

### 4. Underwater
Cool waves with spatial spread. Dynamic but restrained.
```
/mode/underwater/start
```

## OSC Control

### Audio Features (continuous)
```
/audio/rms           <0-1>
/audio/low           <0-1>
/audio/lowMid        <0-1>
/audio/mid           <0-1>
/audio/high          <0-1>
/audio/centroid      <0-1>
/audio/beatPhase     <0-1>
/audio/tempo         <BPM>
```

### Events (one-shot triggers)
```
/event/kick          - Accent pulse
/event/snare         - Secondary accent
/event/drop          - Major shift
/event/breakdown     - Section transition
```

### Mode Control
```
/mode/{floating|drift|candle|underwater}/start
/mode/stop           - Return to idle
```

### System Control
```
/system/blackout     - Turn off all lights
/system/safe_ambient - Fade to safe look
/system/stop_all_modes
/system/restore      - Exit blackout/safe mode
```

## Troubleshooting

### Bridge Not Found
1. Verify bridge IP in CONFIG.yaml
2. Test: `curl -k https://<bridge-ip>/clip/v2/resource/light`
3. Confirm bridge is on same network as control machine

### Entertainment Not Starting
1. Check entertainment area ID exists on bridge
2. Verify all target lights are in the area
3. Review logs for "Entertainment validation failed"

### OSC Not Received
1. Verify OSC sender is transmitting to correct port (default 9000)
2. Check firewall allows UDP on that port
3. Enable `SIMULATE_OSC=1` to test with synthetic data

### Lights Not Responding
1. Check Entertainment connection status in logs
2. Verify Hue firmware is current
3. Try `/system/safe_ambient` to test basic control
4. Check individual light state in Hue app

## Architecture Notes

The engine maintains **state separation**:
- **Input**: OSC messages update state atomically
- **Render**: Fixed-Hz loop resolves priority stack
- **Output**: Hue Entertainment streams frames

This design allows:
- Decoupled input/output rates
- Autonomous motion independent of continuous control
- Safe fallback when upstream disappears
- Future support for non-Hue outputs

## Watchdog Behavior

If no OSC input for `watchdog_timeout_ms`:
1. `oscAlive` flag goes false
2. System enters fallback mode (safe ambient)
3. Autonomous modes continue if enabled
4. When OSC resumes, system recovers automatically

## Logging

Structured JSON logs include:
- System startup and validation
- Mode changes
- Watchdog activations
- Transport failures
- Frame statistics

Useful for debugging and replay analysis.

## Next Steps

1. **Field Calibration**:
   - Adjust mode parameters (speed, depth, palette)
   - Fine-tune phase offsets for even spatial distribution
   - Test audio mapping coefficients with real music

2. **Extensions**:
   - Implement REST scene recall
   - Add custom generator plugins
   - Build control GUI (optional)
   - Export OSC replay harness

3. **Production**:
   - Package as headless service (systemd)
   - Document show-specific configurations
   - Establish backup/recovery procedures
