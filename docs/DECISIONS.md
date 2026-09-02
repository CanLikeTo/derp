# Playground decisions — updated 1 September 2026

## Authoritative automatic-carbine lab

The carbine is always equipped, automatic on primary-button hold, and has unlimited ammunition. Cadence, projectile identity, motion, moving-player/terrain collision, and impact events are server-owned. Local presentation predicts a provisional projectile against static terrain only; player hits remain harmless. This slice deliberately excludes health, damage, death, scoring, ammo, reloads, recoil, spread, weapon switching, rockets, explosions, audio, and finished art.

Combat events are ordered separately from replaceable state snapshots through a generation and contiguous event cursor. Reset and jet-mode changes start a new combat generation. Ordinary resynchronization preserves the authoritative generation, cooldown, and live projectile list. Projectile collision is a pure shared swept-AABB layer; the per-player Rapier controller remains unchanged.

## Authoritative aim slice

The current fuel-limited jet rules are retained. The next slice adds mouse-only absolute 360-degree aim without firing, weapons, body rotation or collider changes. Aim travels in the existing tick-addressed input frame as signed 16-bit `aimQ`; no pointer-coordinate or separate aim-message path is introduced. Missing input preserves the last authoritative angle while neutralizing movement, jump and thrust.

The canvas's live CSS rectangle maps the pointer into the fixed world view. Each predicted tick derives its own angle from that world target and predicted player position. Local correction is immediate and measured at the matching tick; remote aim interpolates over the same historical snapshots as remote position. Direction lines and the local reticle are presentation-only, preallocated/bounded resources.

## Scope and dependencies

The approved slice is two anonymous players on one local machine, with solid rectangles and immediate run/jump movement. Prediction/reconciliation/interpolation are included earlier than the original Milestone 0 proof. Advanced terrain, combat, audio, accounts and hosting stay out.

Pinned dependencies: Bun 1.4.0, Rapier2D compatibility package 0.20.0, Three.js 0.185.1, Vite 8.2.2, TypeScript 7.0.2 and Playwright 1.62.1. One workspace lockfile records transitive dependencies. Native Bun WebSockets are provisional for this slice; no claim that a Colyseus comparison has been completed.

The Rapier gate ran the same 900-tick fixture in Bun, Vite development and the built browser client. It also restored a saved state after deliberately moving the reusable query collider elsewhere. Matching outcomes allow the dependent controller work to proceed. `tools/compat-browser.ts` retains the gate for an already running dev/preview URL; `?compat` selects the fixture page. Broader slope/drop-through/platform and impulse compatibility remains unproven.

## Tick contract

Inputs address server ticks, with one command per player per tick and a 16-tick future window. The server advances time independently of traffic. Missing commands are neutral; stale commands are retired. Snapshot tick T finalizes every input through T, including commands that were absent or late. An epoch changes on each baseline so already-delayed work cannot reattach to a replaced timeline.

Movement state is X/Y position, velocity, grounded status and the two jump-forgiveness counters. Jump is a latched discrete edge, not repeated held intent. Each movement query uses the shared immutable room and ignores other players. Restoring the collider and refreshing Rapier before a query prevents stale broad-phase state. No dynamic physical interactions are claimed by this adapter.

Horizontal and vertical movement use separate Rapier sweeps. The combined displacement path was found to suppress downward movement while continuously pushing into a platform side. A failing regression reproduced the cling; the separate sweeps preserve gravity and use surface normals to resolve blocked velocity. This is a rectangle-only arcade controller, not a claim of slope support.

Connection and preset changes first collect three RTT probes, then request a fresh authoritative baseline. Prediction lead is established from measured RTT plus jitter allowance and bounded to 2–12 ticks. Periodic pings update displayed RTT; adaptive congestion control and continuous lead adjustment are deliberately absent. Long stalls and timeline incompatibilities request a baseline instead of unbounded catch-up. The server also discards excessive wall-clock debt and rebases clients after its five-step catch-up bound.

The first soak rehearsal exposed late commands and p95 corrections around 0.267 units when the client initially relied on nominal preset delay. Measuring RTT before enabling movement resolved that failure: the corrected rehearsal reported zero p95 correction. The correction budget was not relaxed. Tick-duration percentiles are calculated at 4 Hz rather than sorted anew for every recipient's snapshot; this avoids making the diagnostics dominate the workload being measured.

A later reconnect exposed a discarded-baseline race during a latency-preset change. Resync requests therefore recover the current socket's player even when the request carries an older epoch. Inputs, suspend, and reset still require the current epoch; resync cannot claim another player or change physical position/velocity; it clears buffered intent for the new epoch. Live integration tests explicitly discard a baseline and verify recovery, and browser tests repeatedly switch latency while joining.

Preset changes before the first baseline restart admission, because clearing delayed work may cancel the initial hello before any player or epoch exists. A browser regression first reproduced the resulting timeout, then verified recovery after this change. The preceding soak was intentionally stopped at twelve reset/rejoin cycles to test the corrected source for the full duration.

Reconciliation error compares state at the same tick. Visual smoothing never changes collision truth. Remote rendering subtracts estimated one-way transit and another 100 ms of buffering; it holds the most recent pose rather than extrapolating an invented future.

## Local serving and admission

Fixed loopback ports: Bun 3001, Vite dev 5173, Vite preview 4173. Vite proxies `/ws`, rewrites the Host to the known backend authority, and preserves the browser Origin. The backend accepts only the two exact frontend origins and its exact loopback Host. CORS and wildcard host acceptance remain disabled. The endpoint is not a substitute for authenticated online admission.

The launcher keeps child stdin pipes open and owns shutdown through signals. Vite can interpret stdin EOF as a shutdown request, so detached/ignored input is unsuitable for the supervised local process. Server watch mode is deliberately excluded because it can survive an initial bind failure; startup must fail and clean up both processes. Soak readiness fetches have an explicit timeout and consume their response bodies.

Connection-local identities are server-generated UUIDs. Two joined seats and at most eight pending/live sockets bound admission. There are no tickets, owner roles, durable users or reconnect grace. A third hello gets a readable rejection before closure. A new connection always gets a new identity.

Client and server queues have explicit caps. Server output retains only the latest unsent snapshot; control messages cannot bypass congested transport indefinitely. A 120-message/second token bucket, 120-message burst, 2 KiB input limit, liveness checks and epoch checks protect the local harness against mistakes and basic malformed traffic.

## Validation interpretation

Simulation/protocol tests, browser workflows, and a repeatable soak are separate evidence. Headless frame timing is recorded but is not a hardware-floor or gameplay-capacity certification. The 30-minute soak uses two isolated browser processes so both can generate normal focused keyboard input; it does not bypass the application's input/transport path.

The user-reported jump-forgiveness playtest passed on 31 August 2026. Remaining gates include broader movement/traversal feel, specific Chrome/Firefox/Safari hardware checks, real TCP impairment, broader physics features, and choosing whether to retain native Bun before implementing the larger lobby/network stack. Auth/SQLite/provider compatibility must be established before the auth milestone. No remote resources were created.

Primary references: [Rapier initialization](https://rapier.rs/docs/user_guides/javascript/getting_started_js/), [character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/), [Bun WebSockets](https://bun.com/docs/runtime/http/websockets), [Vite serving options](https://vite.dev/config/server-options).

## Forgiving jump controls

Coyote time and landing buffering are six simulation ticks each (~100 ms), initial tuning values for a local playtest. Releasing a pre-landing tap keeps it buffered, as explicitly chosen for dERP. This reduces timing precision required without changing speed, gravity, jump height, immediate reversal, geometry or equal air control. Jets and variable jump height remain separate experiments.

Counters belong to authoritative replay state, not presentation or wall-clock timers. Landing consumes a buffered tap immediately at contact, with upward travel starting next tick. Separate sweeps and the existing wall-pressure falling fix remain intact. Full boundary semantics and lifecycle cancellation are specified in `PROTOCOL.md`.

A retired command and buffered state are different: timely input can legitimately leave unconsumed state in a snapshot; an expired or missing command cannot be replayed to invent that state. Fresh epochs cancel buffered intent without changing physical momentum or refilling coyote. Local pending replay must also be discarded during suspension to avoid cosmetic phantom jumps while waiting for the server.

Protocol/content/trace versions are 2 / playground-2 / 2. The diagnostic envelope stays at 1. Dependencies remain pinned. The earlier stickiness report was traced by the user to remote screen access; its rendering patch was reverted and is not reinstated here. Assess feel directly on the computer.

Soak evidence now goes into a unique build-labelled run directory so previous reports remain available. Headless correctness and soak measurements do not stand in for direct human movement feedback or real-display timing. This is progress within IDEA's movement milestone, not completion of all its traversal or foundation investigations.

The full jump-forgiveness soak completed but exceeded the correction budget. No lead/timing adaptation was added to hide that result. Before acceptance, isolate the late-input burst and retest the unchanged budget; browser RSS growth also needs interpretation beyond the server-only memory alarm. See `VALIDATION.md` for the measurements and their limits.

The user subsequently reported that the jump-forgiveness playtest passed. Retain both six-tick windows; no movement adjustment is called for by that feedback. This human acceptance is separate from the unresolved automated correction budget and browser-memory observations.

## Timing prerequisite before jets — 31 August 2026

A deterministic regression reproduces baseline-only prediction lead becoming insufficient when application latency increases after calibration. With identical movement, seeded jitter and phase, the frozen control has 798 late commands and correction p95 0.40 units; increasing lead from later pings has 13 transitional late commands, p95 zero, and no late commands after settling. These are virtual-clock results, not live-browser measurements or proof of the old soak's cause.

Use the smallest demonstrated fix: allow the existing bounded lead formula to increase on later pong samples. Do not change clock mapping, physics, server deadlines, rendering, or acceptance thresholds. Keep lead from decreasing until a fresh epoch to avoid an input-generation pause. Add per-player receipt counters and bounded correlated timing evidence. The 30-minute unchanged-budget base-movement soak remains the gate for jet work. If that gate fails, leave jets unimplemented and report the evidence.

The instrumented live soak subsequently failed its correction gate. A post-reset P1 epoch had 939 observed late commands out of 3,589 correlated commands, with 272 corrections above 0.08 units out of 1,198 snapshots. Outgoing delay p95 was 73.6 ms, similar to its neighbouring epochs, but the inferred tick-mapping residual was approximately +2.95 ticks instead of zero. The following baseline removed the residual. This inference includes transport/dispatch and tick quantization; it is not a subtraction of browser and server clock origins.

A separate deterministic case confirms that delaying one baseline by 50 ms can leave persistent clock bias even with the new lead updates. Therefore bounded lead growth is an incomplete fix. Per the approved stop condition, leave jets unimplemented. The next timing change must repair stale authoritative-clock mapping, test delayed baselines as well as ongoing latency changes, and pass the same full-duration correction budget without hiding corrections or relaxing limits. No clock-adjustment algorithm is accepted solely from the aggregate percentile.


## Timestamp-based baseline age

The delayed-baseline reproduction justifies replacing the baseline's assumed half-RTT age. `ServerClock` estimates the server/browser monotonic offset from ping midpoints, choosing the lowest RTT among eight recent samples to limit queue-delay contamination. It ages each baseline using its server timestamp and that estimate. Absolute process clock origins are never assumed equal. Asymmetric transit remains an estimation limitation; this local harness does not establish internet fairness.

Later offset changes slew the running tick estimate at 90–110% of normal speed. They neither reverse time nor freeze input generation. A fresh baseline can immediately establish a new tick/time relation, including after server timing debt was discarded. Connection and latency-preset changes clear clock samples. Lead retains the existing 2–12 formula; there is no increase to server windows, history limits, correction thresholds, or simulation delta-time.

Retain frozen-lead and biased-baseline controls as evidence of the old defects. The new mapping must pass the same scenarios, varied frame phases, short/long stalls, live delayed-baseline browser checks, and the full soak. Add opt-in retained-heap/DOM profiling of test-owned Chromium pages; label forced collections because they can affect scheduling. All timing samples remain included.

## Jet experiment

The timestamp-mapping prerequisite passed its full soak and retained-memory investigation before jet implementation started. Keep the previous render interpolation patch reverted. Jets are an experiment behind a shared server-owned toggle, disabled on startup. Either Shift supplies held thrust; both keys must release for grounded refill. Use the agreed 45 fuel ticks, 45 acceleration, 12 upward cap and one fuel tick of recharge per grounded released tick.

Rules, fuel and completed-tick activity are authoritative replay state. A mode change resets both players with a two-phase epoch rebase, sharing Reset's throttle. Repeated same-value requests are harmless no-ops. Keep simple DOM fuel/jet indicators and one static roof; do not add combat, imported art, effects or audio. Preserve the six-tick jump forgiveness and separate collision sweeps. Local comparison against the saved pre-jet fixtures matched all 1,431 ticks exactly with jets disabled.

The next human decision is whether short bursts improve air control while ordinary jumps, platforms and landings remain useful. Keep, revise or remove the experiment before choosing combat work; passing network tests is not proof of movement feel.

## Browser scheduling allowance

The first jet soak failed after warm-up with 0.133333-unit ordinary correction p95. Correlated commands spent 100–120 ms in a queue configured for 40–60 ms; late receipts accompanied most large corrections. A fuel-display optimization did not survive an original/modified/original performance comparison and was not retained. Do not blame that UI change or reinstate the reverted render interpolation patch.

Build `playground-jets-v2` measures how late each browser delay-queue callback runs relative to its due time. Add the largest of the last 120 measurements (each clamped to 0–250 ms) to the configured jitter allowance in the existing lead formula. Both directions contribute; disconnect and preset changes clear the samples. A live epoch can only increase lead, still bounded to 2–12 ticks. Server deadlines, 16-tick future window, physics and correction budgets stay unchanged. This conservatively budgets observed main-thread delay without pretending it is packet loss. Sudden stalls can still expire commands before adaptation, and larger lead delays authoritative execution; assess the trade-off in the human playtest.

The repeated 70 ms virtual-stall control has ten late commands (four after settling); measured allowance reduces that to one (zero after settling), with the same server execution and retirement rules. Browser coverage measures the allowance under repeated short stalls. Full-duration acceptance remains required and is reported separately in `VALIDATION.md`.
