# dERP — local authoritative carbine playground

A responsive, server-authoritative two-player foundation for a deeply unserious arena platformer. This build has two boxes, solid platforms, and useful diagnostics. Explosions come later.

## Run it

Requires **Bun 1.4.0** and a desktop browser with WebGL2 and WebAssembly. Node 24+ is used by the Playwright test tooling; browser gameplay and the server do not depend on Node.

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:5173** in two windows. Click **Connect** in each, then click the arena to activate it. Move the mouse for full 360-degree aim and hold the primary mouse button to fire the unlimited automatic carbine. Local shots appear immediately; projectile motion and harmless player/terrain impacts are confirmed by the server. A/D or Left/Right moves; Space jumps. Holding Space does not auto-jump. Click **Enable jets · resets both players** to enable the shared jet experiment, then hold either **Shift** key. Fuel lasts 45 simulation ticks (0.75 seconds); release both Shift keys while grounded to refill. Jets start disabled on server startup. A third connected player is rejected. Only the focused arena takes input.

`Disconnect` releases a seat. `Reconnect` creates a fresh anonymous identity. `Reset playground` resets both players through the server. Selecting a latency preset requests a new timing baseline. The debug ghost is an older authoritative pose, not an error measurement.

Stop with Ctrl+C; the supervisor stops both Bun and Vite. All listeners bind to `127.0.0.1`, and occupied ports fail instead of being changed silently. Do not add tunnels, port forwarding, public binds, or expose this unauthenticated development build online.

Vite reloads browser changes. Restart `bun run dev` after changing server/shared simulation code, then reconnect the windows. The server intentionally does not use Bun watch mode: a startup failure must exit and clean up the other process.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Bun server on 3001 + Vite on 5173 |
| `bun run check` | Strict TypeScript, package boundaries, unit and loopback integration tests |
| `bun run build` | Browser assets and a bundled Bun server in `dist/` |
| `bun run preview` | Built server on 3001 + browser preview on 4173 |
| `bun run compat` | Bun Rapier restoration/replay fixture |
| `bun run test:e2e` | Built-preview workflows in Chromium, Firefox, and WebKit |
| `DERP_MODE=dev bun run test:e2e` | The same workflows against Vite development |
| `bun run replay` | Replay the built-in movement trace |
| `bun run replay:combat` | Replay the deterministic two-player projectile-lab trace |
| `bun run replay path/to/export.json` | Replay a trace or the trace inside a diagnostic export |
| `bun tools/timing.ts` | Reproduce the frozen/adaptive timing regression and save local evidence |
| `bun tools/analyze-timing.ts path/to/timing.jsonl` | Correlate soak commands and corrections without comparing clock origins |
| `bun tools/analyze-heap.ts path/to/file.heapsnapshot` | Summarize local V8 retained-object counts and self sizes |
| `bun run soak` | 30 minutes, two isolated Chromium clients, movement/reset/rejoin cycles |
| `bun run soak 1800 --jets --profile-memory` | Full jet acceptance run with held-thrust cycles and retained-memory profiling |
| `bun run soak 1800 --jets --carbine --profile-memory` | Full carbine acceptance run with deterministic aim/fire/reset/rejoin cycles |
| `bun run soak 1800 --profile-memory` | Soak plus retained Chromium heap/DOM samples and local heap snapshots |
| `bun run soak 60` | Short harness rehearsal; not the acceptance soak |

Before browser testing:

```sh
bunx playwright install chromium firefox webkit
bun run build
bun run test:e2e
```

Linux CI may need `bunx playwright install --with-deps chromium firefox webkit`. Browser tests and the soak start/stop their own servers, so close existing dev/preview sessions first. Run checks sequentially with the soak when they need its fixed ports. Ordinary integration tests use ephemeral loopback ports.

## What is authoritative?

The server owns movement, aim, carbine cadence, projectile spawn/motion/collision, jet rules/fuel, player identities, admission, and reset. Clients send one movement/jump/thrust/aim/fire intent for a target server tick, never a position or a client-selected delta-time. Simulation runs at 60 Hz and full snapshots at 20 Hz. Missing commands neutralize movement, jump, thrust, and fire while preserving the last authoritative aim. Late input cannot create a later shot.

Local prediction uses exactly the same simulation code. A snapshot after tick T retires all input through T; the client restores the complete authoritative state and replays subsequent inputs. Position and aim errors are compared at the same tick. Remote players use position and shortest-arc aim interpolation with 100 ms extra buffering beyond estimated transit. Positions and collisions are X/Y only; rendered depth and direction indicators are cosmetic.

Blur/visibility loss clears input, pending prediction and buffered jump intent, and suspends commands. Focus restoration, long frame gaps, resets, and timing overruns obtain fresh baselines. Connection replacement invalidates delayed callbacks. There is no account continuity or reconnect reservation.

## Measurements and limitations

Use **Export diagnostics** to download a bounded local JSON record with timing samples, combat/event counters, environment details, and a replayable pending-input trace. It includes projectile/effect resource counts, message-byte maxima, carbine cooldown, aim corrections, room generation/event cursor, room rules, jet state, input outcomes, and correlated timing records. Player traces require version 5 / content `playground-5`; the separate room replay uses `projectile-lab-1`. Records stay local.

Generated test reports and screenshots are under `artifacts/`; each soak writes `report.json`, `timing.jsonl`, screenshots and its log into a unique `artifacts/<build>-soak-<seconds>s-<timestamp>/` directory; Playwright failures also keep traces in `test-results/`. The soak checks queue/entity bounds, error counts, correction and traffic budgets, and post-warm-up memory. Its 32 MiB median-growth alarm is an investigation trigger, not a proof that every leak is absent. Inspect the time series as well as the pass/fail result.

The earlier jump-forgiveness soak exceeded the correction budget (0.1333-unit p95 versus <0.08). The first timing prerequisite build still exceeded that budget. The timestamp-based clock fix now passes both browser matrices and the full 30-minute soak; retained-memory profiling found no accumulating gameplay resources. The fuel-limited jet experiment passed its automated acceptance and has been retained as the current traversal rule. The authoritative aim and carbine slices pass their automated replay, three-engine browser and soak gates; their human playtests remain pending in `docs/PLAYTEST.md` and `docs/VALIDATION.md`.

Two headless test browsers verify behavior and resource trends, not representative GPU performance or simultaneous human fun. Playwright WebKit is not real Safari. Read `docs/VALIDATION.md` for what was actually run and what remains unverified.

The Rapier compatibility build embeds WASM and produces a bundle-size advisory (approximately 1 MB compressed for the whole initial client). This is below IDEA's initial 10 MB transfer hypothesis, but cold-start performance still needs real-device measurements.

## Project boundaries

- Browser app: rendering, DOM UI, input, prediction, interpolation, diagnostics.
- Bun app: validated WebSocket transport, bounded admission, authoritative room and scheduler.
- Shared simulation: canonical room, kinematic movement, state restoration and replay; no DOM/network/server imports.
- Shared protocol: versions, runtime message validators, limits and measurement helpers.

No health, damage, death, respawning, scoring, ammo, reloads, weapon switching, auth, lobbies, database, external art/audio, or hosting is included. The carbine is a projectile authority lab, not a complete combat system. The Colyseus comparison, full Rapier terrain sweep, and auth/provider/database compatibility investigation remain deferred.

A Git repository and remote are configured. The CI workflow is provided; remote CI for this change has not been run or verified.

Further reading: [protocol contract](docs/PROTOCOL.md), [implementation decisions](docs/DECISIONS.md), [validation evidence](docs/VALIDATION.md), and [first human playtest](docs/PLAYTEST.md).
