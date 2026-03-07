# IMPLEMENTATION_PLAN.md

## Phase 0
Confirm hardware and network.
- Hue Bridge reachable locally
- entertainment area created and verified
- target fixtures selected
- control machine on stable local network

## Phase 1
Define protocol and config.
- finalize OSC namespace
- finalize config schema
- implement config loader and validation

## Phase 2
Build core runtime.
- OSC receiver
- state store
- render loop
- mode manager
- priority resolver

## Phase 3
Build Hue adapter.
- bridge auth validation
- inventory fetch
- entertainment area validation
- low frequency REST helper
- entertainment render path

## Phase 4
Build autonomous generators.
- floating
- drift
- candle
- underwater
- event pulse envelopes

## Phase 5
Build safety and observability.
- watchdogs
- reconnect logic
- safe ambient fallback
- structured logs

## Phase 6
Test and calibrate.
- OSC simulator
- replay harness
- latency observation
- mapping calibration with real music

## Phase 7
Package for operation.
- headless service mode
- sample configs
- operator README

## Acceptance gate
Do not call the system complete until these are verified in a real room:
- one shot floating trigger persists correctly
- kick overlays do not destroy the base motion
- OSC loss leads to safe fallback
- blackout works immediately
- startup and reconnect behavior are understandable from logs
