# Local playground protocol

The executable contract lives in `packages/protocol/src/index.ts`. This document explains the ordering rules that must survive later feature work. Transport is ordered text JSON over the same-origin `/ws` proxy. This protocol is unauthenticated and local-only.

For later releases, change the protocol version when message semantics become incompatible, the content version when shared room/movement data changes, and the build identifier when producing a new test build. Soak reports additionally fingerprint the actual implementation sources and lockfile.

## Admission

The browser sends a hello after the WebSocket opens:

```json
{"type":"hello","protocol":6,"content":"playground-5"}
```

Only the server chooses the player UUID and slot. A compatible hello either receives a `baseline`, or a `rejected` message followed by closure. There are two player seats and eight total pending/live socket slots. Sending input before admission is invalid.

A baseline contains `tick`, `serverTime`, `playerId`, `inputEpoch`, `roomGeneration`, `eventCursor`, complete `players`, complete live `projectiles`, `rules`, recipient `inputTiming`, diagnostic `stats`, and a human-readable `reason`. Player replay state adds `carbineCooldownTicksRemaining`. Room rules accompany every state message.

Before enabling movement, the client measures three round trips, then requests a fresh baseline. Changing latency during admission restarts the connection if a first baseline has not arrived. This prevents clearing a delayed hello without replacing it.

## Input and finalized time

```json
{"type":"input","inputEpoch":7,"tick":121,"moveX":1,"jumpPressed":false,"jetHeld":false,"aimQ":8192,"fire":true}
```

An input is one tick of intent. `moveX` is exactly -1, 0 or 1. The jump flag is a press edge, `fire` is held automatic intent, and `aimQ` is a required signed 16-bit direction. Clients cannot send elapsed time, positions, velocities, cursor coordinates, projectile state, or a target player. Unknown fields are rejected.

## Authoritative carbine (protocol 6 / content playground-5 / trace 5)

The server decrements the replayed carbine cooldown before evaluating each tick. Held fire authorizes shots at S, S+10, S+20, giving six shots per second. Missing, suspended, retired, invalid, or obsolete input means `fire=false`; taps received while cooldown is active are not queued. The room caps live projectiles at 12 and still consumes cooldown when that cap rejects a legal attempt.

Projectiles travel 36 units/second for at most 45 movement ticks. The authoritative room advances existing projectiles, performs swept tests against expanded terrain and moving non-owner player AABBs, resolves impacts, then spawns newly authorized shots. Earliest collision wins; equal-time terrain wins before terrain index and player slot/ID. Hits are visual only. Projectile-to-projectile and owner collisions are ignored.

Shot and impact events use ordered nonreplaceable `events` batches with contiguous IDs. State messages carry the current event cursor and full projectile list. Clients ignore duplicates and old generations and resynchronize on gaps or a snapshot cursor ahead of processed events. Reset and jet-mode changes advance `roomGeneration`, clear combat state, and reset projectile/event IDs. Ordinary baselines preserve the current generation and live authoritative projectiles.

The local client predicts authorized shots immediately and checks only static terrain. It never predicts a player hit. A shot event matches provisional work by generation, owner, input epoch, and source tick; only an authoritative impact produces an impact cue. Remote projectiles use the same historical render time as remote players without extrapolation. Build ID: `playground-carbine-lab-v1`; the separate room replay is `projectile-lab-1`.

For current server tick T, only ticks T+1 through T+16 are accepted. The first valid input for a player's tick wins. Duplicates, expired inputs and old epochs cannot change already simulated time. Missing input at a tick means zero horizontal intent, no new jump press and neutral jet intent while retaining the player's last aim; gravity, collision and already-authoritative jump timers still run. A grounded neutral tick can recharge fuel. Input arrival never advances the room clock.

A snapshot for T describes state **after** that tick. It finalizes every input through T, whether delivered, dropped, absent or late. For example, after snapshot 120, the client deletes pending inputs 118, 119 and 120, restores state 120, and replays only 121 onward. A missing jump at 119 cannot execute later. A timely press may already be represented by a positive authoritative jump-buffer counter at T: retiring its command must preserve that state and allow it to trigger on a subsequent landing.

Prediction error is the distance between the saved predicted state at T and authoritative state at T. Aim correction is the absolute shortest signed-angle difference at the same tick. The latest predicted state is ahead in time and must not be compared directly with an older snapshot for either metric. Rendering offsets never modify simulation state.

## Authoritative aim (protocol 5 / content playground-4 / trace 4)

Aim has 65,536 quantization steps per turn. Angles wrap into -32768 through 32767; an exact half-turn follows the negative, clockwise path. P1 spawns facing right and P2 left. Reset and jet-mode changes restore those spawn directions. Baselines, suspension and resynchronization preserve current authoritative aim unless the action also respawns players.

The browser maps the live renderer-canvas rectangle into the fixed 24 by 13.5 world view. It sends no pointer events or coordinates over the network: each predicted tick converts the current world target relative to that tick's predicted player position and includes only `aimQ` in the normal input frame. A target within 0.1 world units retains the prior direction. Aim never changes collision, movement, jump eligibility or fuel.

Local reconciliation restores authoritative aim and replays only inputs newer than the finalized snapshot. Remote aim uses the same before/after snapshots and historical render tick as remote position, interpolating the shortest arc. Buffer underruns hold both pose and aim; there is no extrapolation. Build ID: `playground-aim-v1`. The diagnostic envelope remains version 1.

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

## Timing prerequisite (protocol 3 / playground-2)

Build `playground-timing-v1` keeps movement and trace version 2 unchanged. Baselines and snapshots now require recipient-specific `inputTiming`: accepted, late, duplicate, missing, queued counters and at most six recent input receipts. Each receipt has the input epoch/target tick, server receipt tick/time and accepted/late/duplicate outcome. Counters last for that anonymous participant's connection; existing aggregate server counters remain distinct. A missing command is counted on each active neutral server tick, including the neutral interval seeded after a baseline. Suspension and obsolete epochs are ignored before receipt counters.

The initial lead remains `clamp(ceil((RTT/2 + preset jitter)/tick duration)+2, 2, 12)`. Later pong samples can increase it using the same formula and the maximum of the last three RTT samples. Lead never shrinks within an epoch; a new baseline recalculates it. This avoids deliberately pausing the input timeline to drain a reduced lead. The server step rate, input deadline/window, retirement, and movement/rendering behavior are unchanged. A sudden latency increase may still expire commands before the next ping arrives; no old intent is replayed on the server.

Local diagnostic exports add a bounded 2,400-record timing log (generation, actual send, server receipts, tick-matched corrections, ping clock observations and baselines). Records have monotonic local sequence numbers. Correlate by player identity, input epoch and target tick. Browser `at` and server `receivedAt` have different clock origins: never subtract them. Receipt records may repeat across snapshots. The soak writes these records incrementally to `timing.jsonl`, separate from its small sampled summary; each replaced browser page starts a new record sequence.

`bun tools/timing.ts` reproduces a seeded virtual-clock regression with the real room and prediction. Its frozen control retains the previous baseline-only lead. A 50-to-100-ms per-direction delay increase after calibration demonstrates persistent expired input; updating lead removes that persistent failure. Tests also vary frame phase and exercise 40/180/1,000-ms stalls. This identifies a concrete defect, but does not by itself establish the cause of the earlier uninstrumented soak.

The command also emits `biased-baseline.json`, a regression control with the old clock mapping, and `mapped-baseline.json`, the repaired mapping under the same 50 ms baseline-only delay. The old control retains its known failure; the mapped case must have zero late commands after settling and correction p95 below 0.08. Unit coverage also varies baseline delay (0/50/150 ms) and frame phase.

`ServerClock` maps monotonic clocks from ping midpoints. Among eight recent observations, the lowest-RTT sample determines the target offset. A baseline's age is `max(0, browserNow + estimatedOffset - baseline.serverTime)`, rather than a presumed half RTT. The tick estimate is anchored to that baseline's tick and timestamp. Offset corrections between baselines slew at 90–110% speed; no backward steps or frozen input time. A new baseline resets the tick anchor (required after server overruns). Disconnect or a changed latency preset clears clock samples. Ping asymmetry and tick phase still limit estimation accuracy; server authority and deadlines remain unchanged.

## Fuel-limited jet experiment (protocol 4 / content playground-3 / trace 3)

That jet build introduced protocol **4** and content **`playground-3`**; the current aim build supersedes them with protocol 5 and content `playground-4`. Jet input still requires `jetHeld: boolean`. State snapshots require `rules: { jetsEnabled: boolean }`, and every player has integer `jetFuelTicksRemaining` in 0–45 and boolean `jetActive`. Traces carry the same explicit rules and complete inputs/state.

Either Shift key holds thrust. Both must be released to refill on the ground. There are 45 fuel ticks; an active tick consumes one, applies upward acceleration 45 alongside gravity 30, and caps upward velocity at 12. Releasing removes acceleration, not existing momentum. Grounded released ticks refill one, capped at 45. Holding an exhausted jet never refills or relaunches. Players spawn with full fuel. `jetActive` records thrust applied on the completed tick, including the final fuel-consuming tick with fuel zero.

Existing jump/buffer eligibility runs first, then thrust; a valid simultaneous jump uses jump velocity before gravity and thrust. The two collision sweeps remain unchanged. Thrust clears coyote and does not arm walk-off coyote or consume an unfulfilled landing buffer. A buffered landing jump still starts vertical displacement next tick and does not refill on its landing tick. Ceiling-blocked thrust consumes fuel. Disabled mode ignores jet input, keeps fuel full and preserves ordinary movement.

`{"type":"setJets","inputEpoch":7,"enabled":true}` is an admitted player's room-wide control. Obsolete epochs are ignored. Same-value requests are no-ops before the shared one-second Reset/mode-change throttle. A changed mode resets both players, prepares both epochs, then sends both baselines without advancing simulation time. Reset preserves mode, as do departure/rejoin; server startup disables it. Clients adopt rules from baselines and request resync on an incompatible snapshot. No optimistic room-mode switch is applied.

Suspend/resync preserve fuel and momentum but clear held input, pending replay and activity. Later neutral simulation ticks may legitimately refill a grounded player; creating a baseline itself never grants fuel. Duplicates and expired input never add simulation time. Reconnection creates a fresh full-fuel spawn.

A shared solid roof at `(0,13.25)`, size `24×0.5`, contains both modes. Labels clamp inside the view. The local fuel meter uses prediction; remote `JET` text uses the same historical interpolation interval as its pose. Diagnostics export rules, jet configuration, fuel/activity and separate ordinary/thrust correction summaries. No particles, audio or additional player meshes are created.

Build `playground-jets-v2` additionally measures browser timer lateness on both delayed queues. The largest of the last 120 samples, each clamped to 0–250 ms, is added to preset jitter in the lead formula. Diagnostics expose `schedulingJitterMs`; generation records include it, and `scheduling` records explain resulting lead increases. Samples clear on disconnect or preset changes. The live lead still never shrinks and remains 2–12 ticks. This changes only the client's estimate of required deadline margin, not the wire protocol, authority, simulation delta-time or server future window. `bun tools/timing.ts` saves fixed/measured repeated-stall controls alongside the earlier regressions.
