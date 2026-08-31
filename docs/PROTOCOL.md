# Local playground protocol

The executable contract lives in `packages/protocol/src/index.ts`. This document explains the ordering rules that must survive later feature work. Transport is ordered text JSON over the same-origin `/ws` proxy. This protocol is unauthenticated and local-only.

For later releases, change the protocol version when message semantics become incompatible, the content version when shared room/movement data changes, and the build identifier when producing a new test build. Soak reports additionally fingerprint the actual implementation sources and lockfile.

## Admission

The browser sends a hello after the WebSocket opens:

```json
{"type":"hello","protocol":2,"content":"playground-2"}
```

Only the server chooses the player UUID and slot. A compatible hello either receives a `baseline`, or a `rejected` message followed by closure. There are two player seats and eight total pending/live socket slots. Sending input before admission is invalid.

A baseline contains `tick`, `serverTime`, `playerId`, `inputEpoch`, complete `players`, diagnostic `stats`, and a human-readable `reason`. Each player contains `id`, `slot`, `x`, `y`, `vx`, `vy`, `grounded`, `coyoteTicksRemaining`, and `jumpBufferTicksRemaining`. Times use the server's monotonic clock; browser and server clock origins must not be compared directly.

Before enabling movement, the client measures three round trips, then requests a fresh baseline. Changing latency during admission restarts the connection if a first baseline has not arrived. This prevents clearing a delayed hello without replacing it.

## Input and finalized time

```json
{"type":"input","inputEpoch":7,"tick":121,"moveX":1,"jumpPressed":false}
```

An input is one tick of intent. `moveX` is exactly -1, 0 or 1. The jump flag is a press edge, not a held button. Clients cannot send elapsed time, positions, velocities, or a target player. Unknown fields are rejected.

For current server tick T, only ticks T+1 through T+16 are accepted. The first valid input for a player's tick wins. Duplicates, expired inputs and old epochs cannot change already simulated time. Missing input at a tick means zero horizontal intent and no new jump press; gravity, collision and already-authoritative jump timers still run. Input arrival never advances the room clock.

A snapshot for T describes state **after** that tick. It finalizes every input through T, whether delivered, dropped, absent or late. For example, after snapshot 120, the client deletes pending inputs 118, 119 and 120, restores state 120, and replays only 121 onward. A missing jump at 119 cannot execute later. A timely press may already be represented by a positive authoritative jump-buffer counter at T: retiring its command must preserve that state and allow it to trigger on a subsequent landing.

Prediction error is the distance between the saved predicted state at T and authoritative state at T. The latest predicted pose is ahead in time and must not be compared directly with an older snapshot for this metric. Rendering offsets never modify simulation state.

## Control messages

| Client message | Server behavior |
| --- | --- |
| `{"type":"ping","nonce":4}` | Returns `pong` with matching nonce, tick and server time. |
| `{"type":"suspend","inputEpoch":7}` | Stops accepting that epoch's gameplay input and clears its queue and buffered jump intent; gravity continues. |
| `{"type":"resync","inputEpoch":7}` | Assigns a new epoch, clears pending input and buffered jump intent, and returns a fresh baseline. |
| `{"type":"reset","inputEpoch":7}` | Resets both players and sends new baselines/epochs to both connections. |

Suspend and reset require the current epoch. Resync intentionally accepts an older epoch belonging to the same socket: the browser may have cleared a newer baseline while changing presets. This is recovery for a socket-owned identity, not permission to select another player.

Focus restoration and frame gaps over 250 ms request resync. Excess server timing debt is discarded after at most five catch-up steps, then both clients receive fresh baselines. Disconnect releases identity and seat; reconnect never reserves or restores the old identity.

## Bounds and observations

Incoming client frames are limited to 2 KiB. The token bucket refills at 120 messages/second with a 120-message burst capacity. Invalid fields, future-window abuse, wrong versions and flooding receive an explicit rejection where transport permits one; oversized transport frames may close before application JSON is processed.

Clients retain at most 120 predicted ticks and 40 remote snapshots. Artificial-delay queues cap at 256 entries and preserve order. The server keeps only the latest unsent snapshot under backpressure and closes a connection that exceeds 64 KiB buffered or stays blocked for two seconds. A full snapshot supersedes older unsent snapshots; control messages cannot accumulate around this bound.

The 50/100 ms per-direction presets add seeded application delay with bounded jitter. They do not drop TCP packets. Remote rendering uses estimated server time minus estimated one-way transit minus another 100 ms, and holds the latest pose when it runs out of history.

See `tests/unit/simulation.test.ts`, `tests/unit/network.test.ts`, `tests/integration/server.test.ts`, and `tests/e2e/playground.spec.ts` for authority, retirement, bounds and recovery examples.

## Jump forgiveness (protocol 2 / playground-2)

Both remaining-tick counters are required integers in 0–6. Spawn and reset set them to zero. Missing, fractional, negative or oversized counters are invalid; old clients and traces require a new build, not silent defaults. Inputs still contain only the existing jump press edge. Build ID: `playground-jump-forgiveness-v1`.

Walking off at the end of tick W stores six coyote ticks, usable on W+1 through W+6. A press at the beginning of P loads six buffer ticks, usable on P through P+5. An unused press has five ticks remaining after P; it is expired before P+6. A genuine new press refreshes one slot; releasing Space preserves the tap, and holding/repeat does not add presses.

At each tick: load a press; launch if grounded or within coyote time; perform the existing horizontal/vertical collision sweeps; consume a valid buffer if downward motion lands; age unconsumed counters. A landing launch leaves position at resolved contact, sets vy=12 and grounded=false, and moves upward on the following tick. It never adds a second sweep or extra time. Every launch clears both counters and cannot rearm coyote on that step. Grounded states store zero coyote; walls and ceilings grant none.

Restoration and replay include both counters. Suspend and every new baseline clear buffered intent and queued commands while preserving physical position, velocity and remaining coyote time. They do not refill coyote or cancel jumps already launched. Global rebases prepare all players before sending any baseline. Delayed suspend takes effect only when the server receives it.

The client clears controls on every baseline. Suspend/resync discard pending prediction and visual offsets, restore the latest authoritative pose, and clear buffered intent only in that local copy. While paused, authoritative snapshots advance with no pending replay; prediction resumes only after a fresh baseline. The stored authoritative snapshot remains unchanged.

Diagnostic envelopes stay version 1; embedded traces are version 2 with content `playground-2` and complete initial state. `bun run replay export.json` validates the trace strictly. Old version-1 traces are explicitly incompatible. Diagnostics expose the configured windows and both live counters. No rendering interpolation changes accompany this slice.
