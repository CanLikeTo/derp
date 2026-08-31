# dERP — local movement playground

A responsive, server-authoritative two-player foundation for a deeply unserious arena platformer. This build has two boxes, solid platforms, and useful diagnostics. Explosions come later.

## Run it

Requires **Bun 1.4.0** and a desktop browser with WebGL2 and WebAssembly. Node 24+ is used by the Playwright test tooling; browser gameplay and the server do not depend on Node.

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:5173** in two windows. Click **Connect** in each. Click the arena to activate its controls. A/D or Left/Right moves; Space jumps. Holding Space does not auto-jump. A third connected player is rejected. Only the focused arena takes keyboard input; one keyboard cannot control both windows simultaneously.

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
| `bun run replay path/to/export.json` | Replay a trace or the trace inside a diagnostic export |
| `bun run soak` | 30 minutes, two isolated Chromium clients, movement/reset/rejoin cycles |
| `bun run soak 60` | Short harness rehearsal; not the acceptance soak |

Before browser testing:

```sh
bunx playwright install chromium firefox webkit
bun run build
bun run test:e2e
```

Linux CI may need `bunx playwright install --with-deps chromium firefox webkit`. Browser tests and the soak start/stop their own servers, so close existing dev/preview sessions first. Run checks sequentially with the soak when they need its fixed ports. Ordinary integration tests use ephemeral loopback ports.

## What is authoritative?

The server owns movement, collisions, player identities, admission, and reset. Clients send one movement/jump intent for a target server tick, never a position or a client-selected delta-time. Simulation runs at 60 Hz and full snapshots at 20 Hz. Missing commands mean neutral input; late jumps do not fire later.

Local prediction uses exactly the same movement code. A snapshot after tick T retires all input through T; the client restores the complete authoritative state and replays subsequent inputs. Remote players use interpolation with 100 ms extra buffering beyond estimated transit. Positions and collisions are X/Y only; rendered depth is cosmetic.

Blur/visibility loss clears input and suspends commands. Focus restoration, long frame gaps, resets, and timing overruns obtain fresh baselines. Connection replacement invalidates delayed callbacks. There is no account continuity or reconnect reservation.

## Measurements and limitations

Use **Export diagnostics** to download a bounded local JSON record with timing samples, counters, environment details, and a replayable pending-input trace. Records are not transmitted to analytics. Network presets preserve ordering and apply seeded application-level delay/jitter; they do **not** reproduce TCP packet loss or establish internet fairness.

Generated test reports, screenshots, and soak JSON are under `artifacts/`; Playwright failures also keep traces in `test-results/`. The soak checks queue/entity bounds, error counts, correction and traffic budgets, and post-warm-up memory. Its 32 MiB median-growth alarm is an investigation trigger, not a proof that every leak is absent. Inspect the time series as well as the pass/fail result.

Two headless test browsers verify behavior and resource trends, not representative GPU performance or simultaneous human fun. Playwright WebKit is not real Safari. Read `docs/VALIDATION.md` for what was actually run and what remains unverified.

The Rapier compatibility build embeds WASM and produces a bundle-size advisory (approximately 1 MB compressed for the whole initial client). This is below IDEA's initial 10 MB transfer hypothesis, but cold-start performance still needs real-device measurements.

## Project boundaries

- Browser app: rendering, DOM UI, input, prediction, interpolation, diagnostics.
- Bun app: validated WebSocket transport, bounded admission, authoritative room and scheduler.
- Shared simulation: canonical room, kinematic movement, state restoration and replay; no DOM/network/server imports.
- Shared protocol: versions, runtime message validators, limits and measurement helpers.

No auth, lobbies, database, worker IPC, combat, external art/audio, or hosting is included. The Colyseus comparison, full Rapier terrain sweep, and auth/provider/database compatibility investigation remain deferred. This is a scoped foundation plus responsive movement slice, **not completion of all Milestone 0 or Milestone 1 work** in `IDEA.md`.

No Git repository or remote is assumed. A CI workflow is provided, but remote CI is not verified until this code is placed in a repository and the workflow runs.

Further reading: [protocol contract](docs/PROTOCOL.md), [implementation decisions](docs/DECISIONS.md), [validation evidence](docs/VALIDATION.md), and [first human playtest](docs/PLAYTEST.md).
