# Playground decisions — 31 August 2026

## Scope and dependencies

The approved slice is two anonymous players on one local machine, with solid rectangles and immediate run/jump movement. Prediction/reconciliation/interpolation are included earlier than the original Milestone 0 proof. Advanced terrain, combat, audio, accounts and hosting stay out.

Pinned dependencies: Bun 1.4.0, Rapier2D compatibility package 0.20.0, Three.js 0.185.1, Vite 8.2.2, TypeScript 7.0.2 and Playwright 1.62.1. One workspace lockfile records transitive dependencies. Native Bun WebSockets are provisional for this slice; no claim that a Colyseus comparison has been completed.

The Rapier gate ran the same 900-tick fixture in Bun, Vite development and the built browser client. It also restored a saved state after deliberately moving the reusable query collider elsewhere. Matching outcomes allow the dependent controller work to proceed. `tools/compat-browser.ts` retains the gate for an already running dev/preview URL; `?compat` selects the fixture page. Broader slope/drop-through/platform and impulse compatibility remains unproven.

## Tick contract

Inputs address server ticks, with one command per player per tick and a 16-tick future window. The server advances time independently of traffic. Missing commands are neutral; stale commands are retired. Snapshot tick T finalizes every input through T, including commands that were absent or late. An epoch changes on each baseline so already-delayed work cannot reattach to a replaced timeline.

Movement state is X/Y position, velocity and grounded status. Jump is a latched discrete edge, not repeated held intent. Each movement query uses the shared immutable room and ignores other players. Restoring the collider and refreshing Rapier before a query prevents stale broad-phase state. No dynamic physical interactions are claimed by this adapter.

Horizontal and vertical movement use separate Rapier sweeps. The combined displacement path was found to suppress downward movement while continuously pushing into a platform side. A failing regression reproduced the cling; the separate sweeps preserve gravity and use surface normals to resolve blocked velocity. This is a rectangle-only arcade controller, not a claim of slope support.

Connection and preset changes first collect three RTT probes, then request a fresh authoritative baseline. Prediction lead is established from measured RTT plus jitter allowance and bounded to 2–12 ticks. Periodic pings update displayed RTT; adaptive congestion control and continuous lead adjustment are deliberately absent. Long stalls and timeline incompatibilities request a baseline instead of unbounded catch-up. The server also discards excessive wall-clock debt and rebases clients after its five-step catch-up bound.

The first soak rehearsal exposed late commands and p95 corrections around 0.267 units when the client initially relied on nominal preset delay. Measuring RTT before enabling movement resolved that failure: the corrected rehearsal reported zero p95 correction. The correction budget was not relaxed. Tick-duration percentiles are calculated at 4 Hz rather than sorted anew for every recipient's snapshot; this avoids making the diagnostics dominate the workload being measured.

A later reconnect exposed a discarded-baseline race during a latency-preset change. Resync requests therefore recover the current socket's player even when the request carries an older epoch. Inputs, suspend, and reset still require the current epoch; resync cannot claim another player or change gameplay state. Live integration tests explicitly discard a baseline and verify recovery, and browser tests repeatedly switch latency while joining.

Preset changes before the first baseline restart admission, because clearing delayed work may cancel the initial hello before any player or epoch exists. A browser regression first reproduced the resulting timeout, then verified recovery after this change. The preceding soak was intentionally stopped at twelve reset/rejoin cycles to test the corrected source for the full duration.

Reconciliation error compares state at the same tick. Visual smoothing never changes collision truth. Remote rendering subtracts estimated one-way transit and another 100 ms of buffering; it holds the most recent pose rather than extrapolating an invented future.

## Local serving and admission

Fixed loopback ports: Bun 3001, Vite dev 5173, Vite preview 4173. Vite proxies `/ws`, rewrites the Host to the known backend authority, and preserves the browser Origin. The backend accepts only the two exact frontend origins and its exact loopback Host. CORS and wildcard host acceptance remain disabled. The endpoint is not a substitute for authenticated online admission.

The launcher keeps child stdin pipes open and owns shutdown through signals. Vite can interpret stdin EOF as a shutdown request, so detached/ignored input is unsuitable for the supervised local process. Server watch mode is deliberately excluded because it can survive an initial bind failure; startup must fail and clean up both processes. Soak readiness fetches have an explicit timeout and consume their response bodies.

Connection-local identities are server-generated UUIDs. Two joined seats and at most eight pending/live sockets bound admission. There are no tickets, owner roles, durable users or reconnect grace. A third hello gets a readable rejection before closure. A new connection always gets a new identity.

Client and server queues have explicit caps. Server output retains only the latest unsent snapshot; control messages cannot bypass congested transport indefinitely. A 120-message/second token bucket, 120-message burst, 2 KiB input limit, liveness checks and epoch checks protect the local harness against mistakes and basic malformed traffic.

## Validation interpretation

Simulation/protocol tests, browser workflows, and a repeatable soak are separate evidence. Headless frame timing is recorded but is not a hardware-floor or gameplay-capacity certification. The 30-minute soak uses two isolated browser processes so both can generate normal focused keyboard input; it does not bypass the application's input/transport path.

The remaining major gates are human movement feel, real Chrome/Firefox/Safari hardware checks, real TCP impairment, broader physics features, and choosing whether to retain native Bun before implementing the larger lobby/network stack. Auth/SQLite/provider compatibility must be established before the auth milestone. No remote resources were created.

Primary references: [Rapier initialization](https://rapier.rs/docs/user_guides/javascript/getting_started_js/), [character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/), [Bun WebSockets](https://bun.com/docs/runtime/http/websockets), [Vite serving options](https://vite.dev/config/server-options).
