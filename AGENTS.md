# AGENTS.md

## Project
OSC to Philips Hue local bridge for low latency, music reactive, stateful lighting control.

## Objective
Build a production ready local control system that accepts OSC from audio and performance tools, transforms those messages into a stable internal lighting state, and renders that state to Philips Hue using the Hue Entertainment stack for lower latency continuous output. The system must also support one shot mode triggers so a single OSC message can start a persistent autonomous lighting behavior such as floating, drifting, candle, underwater, or other slowly evolving motion patterns.

This project is not a generic REST bridge. It is a real time stateful control engine.

## Core design stance
Do not send raw OSC directly to Hue.
Do not treat Hue REST as the real time output path.
Do not spread lighting logic across many OSC senders.
Do centralize all mapping, smoothing, scheduling, and fail safe behavior in one local runtime.

## Required files
- `TECHNICAL_DESIGN.md` for architecture, protocols, runtime, data model, and implementation details
- `OSC_SPEC.md` for OSC namespace, payload formats, message semantics, and examples
- `IMPLEMENTATION_PLAN.md` for build phases, milestones, test strategy, and rollout plan
- `CONFIG.example.yaml` for deployable configuration shape
- `README.md` for setup and operator usage

## System intent
The system must support three lighting behaviors at the same time:

1. **Reactive mode**
   Continuous response to incoming audio features such as RMS, low band energy, high band energy, centroid, beat phase, and event triggers.

2. **Autonomous mode**
   One shot trigger starts a persistent internal animation or motion state that continues without requiring continuous OSC.

3. **Override mode**
   High priority events such as blackout, stop all motion, scene recall, or emergency fallback immediately override lower priority behaviors.

The runtime must arbitrate between these modes explicitly.

## Agent roles

### 1. System Architect Agent
Responsible for the top level structure.

Tasks:
- Keep the separation between input, state, render, and transport layers clean
- Prevent direct coupling between OSC sender assumptions and Hue output assumptions
- Enforce future compatibility with Art Net, sACN, WLED, and non Hue outputs
- Keep Hue as one backend, not the whole architecture

Deliverables:
- Architecture diagrams in Markdown
- State model definitions
- Priority rules
- Interface contracts between modules

### 2. Protocol Agent
Responsible for local control protocol definitions.

Tasks:
- Define OSC address space
- Define payload typing rules
- Define one shot commands versus continuous control messages
- Define acknowledgment and observability strategy if needed
- Define versioning policy for OSC namespaces

Deliverables:
- `OSC_SPEC.md`
- Message examples
- Backward compatibility notes

### 3. Hue Backend Agent
Responsible for Philips Hue integration.

Tasks:
- Implement local bridge discovery flow
- Implement secure local authentication and app key handling
- Implement Entertainment area selection and validation
- Implement output rendering pipeline to Hue Entertainment
- Maintain optional fallback support for scene recall or low frequency REST operations
- Track Hue API feature availability and device capability differences

Guardrails:
- Use HTTPS for local API access because current Hue guidance is TLS only for modern firmware
- Use Entertainment for continuous output, not ordinary REST polling loops
- Treat device capability mismatches as first class runtime conditions

Deliverables:
- Hue transport adapter
- Capability model
- Startup validation routine
- Device and area health checks

### 4. Realtime Engine Agent
Responsible for timing and internal motion.

Tasks:
- Maintain master frame clock
- Run render loop at chosen internal tick rate
- Merge continuous features, one shot states, and overrides into one resolved lighting frame
- Generate internal animations such as floating, drift, noise motion, wave, pulse, candle like flicker, underwater movement, and scene transitions
- Support phase offsets across fixtures
- Apply smoothing, easing, and thresholds before output

Guardrails:
- Input event rate and output render rate must remain decoupled
- The engine owns interpolation and motion persistence
- Small changes must be suppressible to avoid visible chatter

Deliverables:
- Deterministic update loop
- Animation generators
- Parameter smoothing layer
- Priority resolver

### 5. Audio Mapping Agent
Responsible for converting music features into lighting intent.

Tasks:
- Map low frequency energy to brightness or spatial weight
- Map high frequency energy to hue shift, sparkle amount, or accent motion
- Map beat phase to wave position or periodic modulation
- Convert kick, snare, drop, and section transitions into state events
- Prevent simplistic one to one mappings that feel cheap or noisy

Deliverables:
- Mapping tables
- Calibration presets
- Music responsive behavior definitions

### 6. Safety and Reliability Agent
Responsible for operational stability.

Tasks:
- Define watchdogs for stalled OSC input
- Define fallback look when upstream data disappears
- Define safe brightness ceilings
- Define network error handling and reconnect strategy
- Define startup and shutdown behavior
- Define logging and replay strategy for debugging

Deliverables:
- Failure mode matrix
- Recovery procedures
- Health checks
- Operator safe defaults

### 7. Tooling and Test Agent
Responsible for local dev and verification.

Tasks:
- Build OSC simulator tools
- Build deterministic replay from recorded OSC sessions
- Create lighting snapshot comparison tests
- Create startup environment validator
- Create end to end latency measurement harness

Deliverables:
- Test scripts
- Sample OSC fixtures
- Replay logs
- QA checklist

## Non negotiable implementation rules

### Rule 1
Continuous OSC is allowed, but direct pass through to Hue is forbidden.

### Rule 2
One shot autonomous behaviors are first class features. A command such as `/mode/floating/start` must cause internal motion to continue without repeated external input.

### Rule 3
Continuous control and autonomous motion must be composable. Example: floating mode may continue while kick events temporarily add pulse energy.

### Rule 4
Transport backends must be pluggable. Hue is the first backend, not the permanent only backend.

### Rule 5
The runtime must preserve state explicitly. Lighting state cannot exist only in transient OSC messages.

### Rule 6
The system must be operable without a GUI. GUI is optional and may be generated later, but the engine must run headless.

### Rule 7
Operator commands must exist for at least these actions:
- start mode
- stop mode
- blackout
- restore safe ambient
- reload config
- list active areas or devices
- print current resolved state summary

## Minimal module layout
- `src/input/osc_receiver.ts`
- `src/input/message_router.ts`
- `src/state/store.ts`
- `src/state/types.ts`
- `src/engine/render_loop.ts`
- `src/engine/mode_manager.ts`
- `src/engine/priority_resolver.ts`
- `src/engine/generators/`
- `src/mapping/audio_mapping.ts`
- `src/output/hue/bridge_client.ts`
- `src/output/hue/entertainment_renderer.ts`
- `src/output/hue/rest_client.ts`
- `src/output/base/output_adapter.ts`
- `src/config/load_config.ts`
- `src/ops/health.ts`
- `src/ops/watchdog.ts`
- `src/tools/osc_replay.ts`
- `src/tools/osc_simulator.ts`

## Operational modes to implement

### Mode A: Reactive only
Continuous OSC features drive the look. Minimal persistence.

### Mode B: Autonomous only
Single trigger starts internal motion with no need for continuous feature input.

### Mode C: Hybrid
Autonomous mode provides the base texture. Continuous OSC adds modulation and event accents.

### Mode D: Manual override
Operator or high priority cue temporarily suppresses other layers.

## Priority order
Highest to lowest:
1. Emergency blackout
2. Safety fallback
3. Manual override
4. Section or scene change
5. Event accents such as kick or drop
6. Autonomous mode base motion
7. Continuous low priority feature modulation

Exact arbitration details are defined in `TECHNICAL_DESIGN.md`.

## Data persistence expectations
The runtime must preserve:
- active mode
- mode parameters
- resolved base palette
- last known audio features with timestamps
- event cooldown timers
- active area and fixture assignments
- last transport health status
- fail safe reason if active

## Logging expectations
At minimum emit structured logs for:
- startup
- bridge discovery
- authentication status
- entertainment area validation
- OSC message acceptance and rejection summary
- mode changes
- watchdog activation
- transport failures
- fallback entry and exit

## What success looks like
A single OSC command can start a persistent floating motion across a Hue entertainment area.
A continuous OSC stream can modulate brightness and color energy without directly owning every frame.
Kick and drop events can temporarily override the base motion and then return control automatically.
If OSC input stops, the system falls back to a stable safe ambient look instead of freezing in an aggressive or broken state.
The same engine can later emit to non Hue backends with minimal changes outside the output adapter layer.

## Official source constraints that must inform implementation
Philips Hue local control is designed around local network bridge access. Bridge discovery and local app key setup are documented in the Hue developer getting started flow. Modern guidance is HTTPS only for local bridge API access, and Signify announced deprecation of HTTP support in 2025. The Hue developer portal also distinguishes ordinary REST control from the Entertainment stack for more dynamic lighting use cases, and notes that the Entertainment Development Kit remains compatible alongside the newer API direction. The Hue support page also warns that ordinary REST command rates should remain low, roughly around 10 commands per second to `/lights` and 1 per second to `/groups`, which is why this project must not use REST as its continuous render path. citeturn0search0turn0search1turn0search3turn0search5turn0search6

## Build order
1. Define protocol and state model
2. Implement OSC ingestion and store
3. Implement internal mode engine
4. Implement Hue bridge auth and area validation
5. Implement Entertainment output adapter
6. Add safety fallback and watchdogs
7. Add replay and simulation tools
8. Calibrate mappings with real music input
9. Package as headless service

## Required cross references
See `TECHNICAL_DESIGN.md` for:
- architecture
- render loop
- state model
- arbitration rules
- Hue output strategy
- network requirements
- test and rollout plan

See `OSC_SPEC.md` for:
- OSC namespace
- payload rules
- examples
- one shot versus continuous control

See `IMPLEMENTATION_PLAN.md` for:
- phased execution
- milestones
- acceptance criteria
