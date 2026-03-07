# TECHNICAL_DESIGN.md

## 1. Purpose
This document defines the implementation architecture for a low latency local OSC to Philips Hue control engine with support for both continuous music reactive control and persistent one shot autonomous motion modes.

## 2. Why this architecture exists
A naive bridge that forwards OSC directly to Hue will fail for three reasons:

1. Ordinary Hue REST control is not designed for dense real time updates.
2. Lighting behavior becomes fragmented across multiple OSC senders.
3. There is no persistent state for autonomous looks, transitions, or fail safe behavior.

The correct model is a stateful render engine with pluggable outputs.

## 3. Official constraints
Hue local APIs are accessed through the bridge on the same local network. The developer getting started flow documents bridge discovery and local app key creation through bridge authorization. Hue has moved to HTTPS as the supported local API transport, with HTTP deprecated in 2025. Hue support guidance also warns that ordinary REST command rates should stay low, around 10 commands per second to `/lights` and around 1 per second to `/groups`. This makes ordinary REST unsuitable as the continuous output path for music reactive rendering. The developer portal separately maintains the Hue Entertainment stack and notes that the Entertainment Development Kit remains compatible with the newer API direction. citeturn0search0turn0search1turn0search3turn0search5turn0search6

## 4. Top level architecture

```text
Upstream sources
  Ableton / Max / TouchDesigner / SuperCollider / Python analyzers / manual cues
        |
        | OSC
        v
OSC Receiver
        v
Message Router
        v
State Store
        |
        +--> Watchdog and health monitor
        |
        v
Mode Manager
        |
        +--> Autonomous generators
        +--> Event accent generators
        +--> Section and scene resolver
        v
Priority Resolver
        v
Frame Composer
        v
Output Adapter Interface
        |
        +--> Hue Entertainment Adapter
        +--> Hue REST Adapter for setup and low frequency ops
        +--> Future Art Net or WLED adapters
```

## 5. Runtime model
The runtime has two clocks.

### 5.1 Input clock
Driven by external OSC arrival. This may be irregular and high frequency.

### 5.2 Render clock
Driven internally at a fixed tick rate. Candidate internal rates:
- 30 Hz for conservative initial testing
- 60 Hz for standard realtime feel
- 100 Hz only if proven stable and useful

Key rule:
Input updates state.
Render clock resolves and emits frames.

Never make transport cadence equal message arrival cadence.

## 6. State model

### 6.1 Input feature state
```ts
interface AudioFeatures {
  rms: number
  low: number
  lowMid: number
  mid: number
  high: number
  centroid: number
  beatPhase: number
  tempo?: number
  confidence?: number
  updatedAtMs: number
}
```

### 6.2 Event state
```ts
interface EventFlags {
  kickAtMs?: number
  snareAtMs?: number
  hatAtMs?: number
  dropAtMs?: number
  breakdownAtMs?: number
  sceneChangeAtMs?: number
}
```

### 6.3 Mode state
```ts
interface ActiveMode {
  name: 'idle' | 'floating' | 'drift' | 'candle' | 'underwater' | 'manual' | 'reactive'
  enabled: boolean
  startedAtMs: number
  params: Record<string, number | string | boolean>
}
```

### 6.4 Transport and safety state
```ts
interface RuntimeHealth {
  oscAlive: boolean
  bridgeReachable: boolean
  entertainmentReady: boolean
  fallbackActive: boolean
  fallbackReason?: string
}
```

### 6.5 Resolved frame state
```ts
interface ResolvedFixtureState {
  fixtureId: string
  brightness: number
  hue: number
  saturation: number
  x?: number
  y?: number
  colorTemperature?: number
}
```

## 7. Control model
The engine supports three classes of control.

### 7.1 Continuous feature modulation
Used for values such as RMS, low band energy, centroid, and beat phase.

Examples:
- low band controls base brightness weight
- high band controls sparkle amount or hue excursion
- centroid controls palette tilt between warm and cool
- beat phase offsets wave position

### 7.2 One shot state triggers
Used for persistent autonomous motion that continues after a single message.

Examples:
- `/mode/floating/start`
- `/mode/underwater/start`
- `/scene/ambient_blue/recall`

### 7.3 Immediate overrides
Used for safety and high priority operator control.

Examples:
- `/system/blackout`
- `/system/stop_all_modes`
- `/system/safe_ambient`

## 8. Arbitration model

### 8.1 Layer stack
Every frame is composed from layers.

1. Safety layer
2. Manual override layer
3. Section or scene layer
4. Event accent layer
5. Autonomous mode layer
6. Continuous feature modulation layer
7. Idle base layer

### 8.2 Composition rules
- Safety layer may replace everything
- Manual override may replace or attenuate lower layers
- Scene layer sets the palette and high level brightness intent
- Event layers are short lived envelopes on top of the base
- Autonomous layer provides persistent movement
- Continuous modulation perturbs existing values instead of redefining the whole look

### 8.3 Event envelopes
Kick and snare should not set raw colors directly. They should spawn envelopes.

Example kick envelope:
- attack: 0 ms to 30 ms
- decay: 120 ms to 180 ms
- target: brightness multiplier and local saturation boost

Example drop envelope:
- attack: 50 ms
- sustain: 500 ms to 2000 ms
- release: configurable
- target: global brightness ceiling, palette shift, spatial sweep

## 9. Autonomous generator design

### 9.1 Floating mode
Goal: slow organic drift.

Suggested behavior:
- base brightness oscillates slowly using low frequency oscillators
- hue shifts in a narrow palette window
- each fixture has phase offset
- noise component adds slight irregularity
- low frequency energy may widen motion depth when hybrid mode is active

Parameters:
- speed
- depth
- palette center
- palette width
- spatial spread
- irregularity

### 9.2 Drift mode
Even slower and more restrained than floating.

### 9.3 Candle mode
Warm base, tiny flicker envelope, strict brightness ceiling.

### 9.4 Underwater mode
Cool palette, broader wave motion, delayed spatial movement across fixtures.

### 9.5 Generator implementation note
Generators should return normalized intent values rather than direct transport payloads.

```ts
interface GeneratorOutput {
  brightnessOffset: number
  hueOffset: number
  saturationOffset: number
  spatialPhaseOffset?: number
}
```

## 10. Smoothing and thresholds
Apply smoothing before transport.

Recommended tools:
- exponential smoothing for continuous features
- deadband threshold to suppress tiny changes
- minimum event cooldown for repeated transients
- separate smoothing constants per parameter

Example:
- brightness smoothing alpha: 0.18
- hue smoothing alpha: 0.08
- ignore brightness delta below 0.01
- ignore hue delta below 1.5 degrees equivalent in normalized domain

## 11. Hue output strategy

### 11.1 Use REST only for
- bridge discovery support flows
- authentication setup
- listing devices and areas
- scene recall when appropriate
- low frequency administrative operations

### 11.2 Use Entertainment path for
- continuous frame output
- hybrid animation output
- music reactive rendering

### 11.3 Why
Official Hue support guidance places practical limits on ordinary REST update rates, while the developer platform keeps the Entertainment stack available for dynamic lighting use cases. That is exactly why this system separates admin operations from render operations. citeturn0search1turn0search5

## 12. Device capability handling
Not every Hue device supports every effect or rendering behavior. Therefore:
- validate entertainment area members at startup
- capture fixture capability metadata
- maintain a degraded mode if some fixtures lack color or gradient features
- expose capability warnings in logs

## 13. Network requirements
- Bridge on stable local network
- Prefer wired Ethernet for bridge and control machine
- Avoid depending on congested WiFi for the core render path
- Reserve static DHCP lease or fixed IP for bridge if possible
- Separate show control network from public traffic where practical

Hue local APIs are explicitly intended for same network operation through the bridge. citeturn0search0turn0search6

## 14. Authentication and startup

### 14.1 Startup sequence
1. Load config
2. Discover or verify bridge IP
3. Validate stored app key
4. Query entertainment areas and device inventory
5. Validate configured target area
6. Initialize output adapter
7. Start OSC receiver
8. Enter idle safe ambient state

### 14.2 App key handling
- never hardcode app key in source
- support `.env` or secret file path
- refuse startup if key missing and no provisioning mode requested

### 14.3 Provisioning mode
Provide explicit operator command for initial bridge authorization.

## 15. Watchdogs and fail safe behavior

### 15.1 OSC watchdog
If no relevant OSC input arrives for configured timeout:
- do not freeze current aggressive state
- either continue autonomous mode if allowed
- or move to safe ambient mode

### 15.2 Transport watchdog
If bridge becomes unreachable:
- record fault
- stop sending dense output loop
- keep local state alive
- attempt reconnect using backoff

### 15.3 Safe ambient behavior
A low brightness restrained palette used during upstream loss or recovery.

Suggested default:
- brightness 0.15 to 0.25
- warm neutral or very soft cool according to installation
- no sharp pulses

## 16. Observability
Emit structured JSON logs.

Suggested fields:
- timestamp
- subsystem
- event
- mode
- area
- bridgeIp
- latencyMs
- droppedMessageCount
- fallbackReason

Support optional metrics endpoint for:
- OSC messages per second
- render frames per second
- transport errors
- average frame build time
- watchdog activations

## 17. Recommended implementation stack
Node.js with TypeScript is the pragmatic choice because:
- OSC libraries are easy to integrate
- local tooling is fast to build
- headless service packaging is simple
- JSON and YAML config handling is straightforward

Rust is valid later if stricter realtime or lower footprint becomes necessary, but it is not the fastest path to a working show system.

## 18. File structure
```text
src/
  config/
  engine/
    generators/
  input/
  mapping/
  ops/
  output/
    base/
    hue/
  state/
  tools/
```

## 19. Suggested configuration model
See `CONFIG.example.yaml`. Core keys should include:
- bridge
- target entertainment area
- render rate
- watchdog timeout
- mode presets
- audio mapping constants
- fixture groups and phase offsets
- safe ambient preset

## 20. Acceptance criteria

### 20.1 Functional
- one shot floating mode persists after a single OSC trigger
- continuous RMS modulation affects output without requiring sender side frame ownership
- kick events create visible accents and decay automatically
- blackout overrides every other layer immediately
- safe ambient activates when upstream disappears

### 20.2 Operational
- system boots headless
- startup validates bridge and area correctly
- logs clearly explain failure states
- config reload works without corrupting runtime state

### 20.3 Extensibility
- output adapter interface can support a non Hue backend later
- OSC namespace remains backend agnostic where possible

## 21. Open implementation choices
These require field testing, not speculation.
- exact internal render rate
- threshold values for visible smoothness versus chatter
- best phase offsets for the specific room layout
- whether some looks should use native Hue effects or engine rendered motion

## 22. Practical recommendation
Start with engine rendered floating mode, not a native Hue effect. Native effects can be added later, but the engine rendered path keeps behavior portable to Art Net, WLED, and other future outputs.
