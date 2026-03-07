# OSC_SPEC.md

## Version
Draft v1

## Design principle
OSC carries intent, features, and triggers. It should not carry raw per fixture transport frames as the default control model.

## Message classes

### 1. Continuous features
Used frequently. Updates the state store.

- `/audio/rms <float 0..1>`
- `/audio/low <float 0..1>`
- `/audio/lowmid <float 0..1>`
- `/audio/mid <float 0..1>`
- `/audio/high <float 0..1>`
- `/audio/centroid <float 0..1>`
- `/audio/beat_phase <float 0..1>`
- `/audio/tempo <float bpm>`
- `/audio/confidence <float 0..1>`

### 2. Events
Used as one shot impulses.

- `/event/kick 1`
- `/event/snare 1`
- `/event/hat 1`
- `/event/drop 1`
- `/event/breakdown 1`
- `/event/scene_change 1`

Any nonzero value is treated as true.

### 3. Mode control
Starts or stops persistent internal motion.

- `/mode/floating/start`
- `/mode/floating/stop`
- `/mode/floating/speed <float 0..1>`
- `/mode/floating/depth <float 0..1>`
- `/mode/floating/palette_center <float 0..1>`
- `/mode/floating/palette_width <float 0..1>`
- `/mode/floating/irregularity <float 0..1>`

Equivalent namespaces exist for:
- `drift`
- `candle`
- `underwater`

### 4. Scene control
- `/scene/ambient_blue/recall`
- `/scene/warm_idle/recall`
- `/scene/build/recall`
- `/scene/drop/recall`

### 5. System control
- `/system/blackout`
- `/system/safe_ambient`
- `/system/stop_all_modes`
- `/system/reload_config`
- `/system/ping`

### 6. Optional manual control
Use sparingly.

- `/manual/master_brightness <float 0..1>`
- `/manual/palette_center <float 0..1>`
- `/manual/palette_width <float 0..1>`

## Semantics

### One shot messages
A message like `/mode/floating/start` is edge triggered. It changes engine state and should not require repetition.

### Continuous messages
A message like `/audio/rms 0.72` updates the latest feature value in the store. It does not directly define transport cadence.

### Conflict rule
System commands outrank scene commands. Scene commands outrank mode parameter tweaks. Event impulses overlay autonomous motion.

## Example hybrid flow
1. `/scene/ambient_blue/recall`
2. `/mode/floating/start`
3. `/mode/floating/speed 0.24`
4. continuous `/audio/rms`, `/audio/low`, `/audio/high`
5. `/event/kick 1`
6. `/event/drop 1`
7. `/system/safe_ambient`

## Why this spec avoids raw fixture control
Raw fixture namespaces like `/light/1/rgb` make the sender responsible for rendering. That kills portability and creates fragmented show logic. Only add raw fixture control for debugging or explicit operator maintenance, not as the main performance protocol.
