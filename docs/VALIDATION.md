# Playground validation — updated 1 September 2026

## Authoritative mouse aim: automated acceptance passed

Build `playground-aim-v1`, protocol 5, content `playground-4`, trace 4. Strict formatting, TypeScript and package boundaries pass. The focused Bun suite has 47 unit tests and 1,699 assertions; all pass. Eight loopback integration tests and 38 assertions also pass when run with local-bind permission. Aim coverage includes signed boundaries/cardinals/wrap, canvas corners, a deterministic clockwise antipode, 1,000 aim-only ticks with identical movement/jet state, missing-input preservation, duplicate authority, strict old/malformed contract rejection, reconciliation retirement and historical shortest-arc interpolation.

Built-preview and Vite-development Playwright matrices each pass all 42 scenarios across Chromium, Firefox and WebKit. The aim workflow verifies immediate local prediction before a delayed authoritative response, two-player direction resources, DPR 2, resize remapping, pointer-leave cleanup and Bun/browser replay parity including exact `aimQ`. Existing movement, jump, jet, lifecycle, admission and WebGL-failure workflows remain green. The production build, Bun Rapier compatibility gate and 900-tick replay pass with the existing Rapier bundle-size advisory.

Full soak: **18:22:51–18:52:55 UTC, 1 September 2026**, 1,800.93 seconds, **30 resets and 30 rejoins**. Every automated gate passed. Source fingerprint `63e23059bc9f4cbd7ea512128fb51be493f60d7a5e2a35f0a2014719d7eacbfe` remained unchanged. Two isolated Chromium clients used the routine 100 ms added-RTT preset, enabled jets and deterministic real pointer sweeps.

| Measure | Worst sampled post-warm-up value | Gate |
| --- | --- | --- |
| Server work p95 / p99 | 1.743 / 2.390 ms | ≤8 / ≤12 ms |
| Position correction p95 | 0 units | <0.08 units |
| Aim correction p95 / maximum | 0 / 2,292 quantization steps | p95 = 0; maximum reported separately |
| Upstream / downstream per player | 6.300 / 31.934 kB/s | ≤8 / ≤64 kB/s |
| Server RSS median growth | 0.172 MiB | <32 MiB investigation alarm |
| Renderer resources | 2 direction lines, 1 reticle, 11 GPU geometries, 3 programs | Stable and bounded |

There were no browser errors or server overruns. Final clients each retained one document, 51 JavaScript listeners and 232–234 DOM nodes; samples temporarily reached 238–240 nodes during profiling/replacement. P1 used heap ranged 5.65–7.06 MB and finished at 5.79 MB; P2 ranged 7.42–7.43 MB and finished at 7.43 MB. Backing storage stayed near 2.69 MB. These samples and stable renderer counts found no accumulating gameplay resources; they do not certify every native browser cache or production workload.

Evidence: `artifacts/playground-aim-v1-soak-1800s-1788286971711/`. Two earlier full-soak startup attempts ended before admission because the fixed-port supervisor reported a transient occupied-port condition; they are not counted as gameplay runs. A corrected 30-second rehearsal passed every gate before the full run.

Installed-browser checks, human aim playtesting, real-display timing, real-network impairment and remote CI remain unverified.

## Jet experiment revision 2: automated acceptance passed

Build `playground-jets-v2` keeps protocol 4, content `playground-3`, trace 3 and all movement/rules unchanged. It adds a bounded measured browser-scheduling allowance to the existing 2–12-tick prediction lead. All 50 Bun tests pass (697 assertions), including delayed-queue instrumentation and repeated-stall retirement. The deterministic repeated-stall control has ten late commands (four after settling); measured scheduling allowance has one (zero after settling). Both have overall p95 zero; this test demonstrates deadline improvement, not a reconstruction of every live failure. Preview and development each pass all 39 Chromium/Firefox/WebKit tests, with no failures, skips or flaky results. Compatibility initialization/restoration, replay and the production build also pass. The existing Rapier bundle-size advisory remains.

Full soak: **20:06:29–20:36:33 UTC, 31 August 2026**, 1,800.91 seconds, **30 resets and 30 rejoins**. Every automated gate passed. Source fingerprint `85d6dc1fac5350f5e12362698a74d66654cc3c3febdd763d08cfc742faf688e8` remained unchanged throughout.

| Measure | Worst sampled post-warm-up value | Gate |
| --- | --- | --- |
| Server work p95 / p99 | 1.724 / 2.343 ms | ≤8 / ≤12 ms |
| Ordinary / thrust / overall correction p95 | 0 / 0 / 0 units | <0.08 units each |
| Upstream / downstream per player | 5.544 / 31.438 kB/s | ≤8 / ≤64 kB/s |
| Server RSS median growth | 0.047 MiB | <32 MiB investigation alarm |
| Prediction / remote history maximum | 23 ticks / 40 snapshots | ≤120 / ≤40 |
| Incoming / outgoing delayed queue maximum | 5 / 6 messages | ≤256 each |
| Scene objects / geometries / programs | 14 / 9 / 2 throughout | Stable |

All 360 sampled states contained two players. There were no errors or server overruns. Twenty-four expired commands were discarded; the largest individual correction was 0.407 units. Zero p95 does not mean every correction was zero. The streamed trace includes nine corrections above 0.08 units among 67,997 matched corrections. Observed lead stayed within 8–12 ticks, measured RTT reached 206.3 ms, and the server input queue reached 16 entries. Headless frame p95 reached 17.4 ms; this is not a real-display benchmark.

Retained-memory profiling captured both clients every five minutes, with heap snapshots at minute five and completion. P1 retained JavaScript heap varied from 5,397,300 to 5,537,096 bytes and ended at 5,499,060; it fell again after minute twenty rather than showing continuous growth. P2 varied from 7,231,940 to 7,297,076 bytes. External backing storage remained about 2.68 MB. Each client retained one document and 49 listeners, with 224 / 222 DOM nodes respectively at every sample. All four heap snapshots contained zero detached nodes. Native socket, document and WebGL-context counts stayed at one per client. The small retained-size differences include browser paint/timing metadata, weak lists and text caches; no accumulating gameplay resources were found.

Browser-subtree RSS first/last-third post-warm-up medians were 1,427.18 / 1,427.80 MiB (+0.62 MiB), within a 1,380.33–1,585.75 MiB range. Snapshot profiling itself causes transient memory and timing overhead, retained in these measurements; RSS also counts shared pages. Server RSS stayed 110.250–110.344 MiB during the last ten minutes. These results support this bounded prototype and do not prove every native cache or production workload leak-free.

Evidence: `artifacts/playground-jets-v2-soak-1800s-1788206789803/` contains the report, full timing stream/analysis, heap samples/snapshots/comparison, process observer, environment, both browser matrices, Bun check log and screenshots. Both final screenshots were checked for framing and visible controls/labels. The soak and observer exited normally.

The run used Bun 1.4.0 and two isolated headless Chromium 151.0.7922.34 processes, 1440×1000, DPR cap 1, routine 100 ms added RTT, arm64 macOS 26.6.2 with ten logical CPUs. At that validation point, the human jet playtest and keep/revise/remove decision were pending; the later aim-slice decision retained the current jets. Installed Chrome/Firefox/Safari manual checks, simultaneous two-human play, real-display/low-end performance, real-network impairment and remote CI remained unverified.

Revision 1's soak was deliberately stopped after its post-warm-up correction p95 reached 0.133333 units. Six resets and five rejoins completed; no unexpected server crash occurred. The report's server-exited reason reflects the deliberate stop. Evidence is retained in `artifacts/playground-jets-v1-soak-1800s-1788205612516/`, including `STOPPED.md`, minute-five heaps and correlated timing. Actual send delays reached 100–120 ms despite configured 40–60 ms application delay. Most large corrections coincided with late receipts.

An original/guarded/original fuel-display profile did not establish a causal rendering problem: frame p95 was approximately 25 / 17 / 17 ms. The speculative unchanged-value guard was not retained. These headless profiles (`artifacts/jet-ui-*.json`) are not real-display performance measurements. The measured scheduling repair keeps server deadlines and all acceptance thresholds intact.

## Historical jet experiment revision 1: correctness passed, soak failed

Build `playground-jets-v1`, protocol 4, content `playground-3`, trace 3. Jets, fuel, shared rules/toggle, roof, indicators and lifecycle behavior are implemented. Existing movement matched the frozen pre-jet outcomes at all 1,431 fixture ticks (maximum numeric difference zero). Formatting, strict types, package boundaries and all 48 Bun tests pass (686 assertions). Compatibility initialization/restoration and the 900-tick replay pass. Preview and development each pass all 36 Chromium/Firefox/WebKit tests, with zero failures, skips or flaky results. The subsequent jet-enabled soak failed as described above.

The first new browser failures exposed test setup assumptions about persistent room mode and disabled-button cooldown; the harness now establishes its mode. Keyboard testing then exposed a short enabled-state lag during cooldown; the UI now disables controls immediately. Roof sampling runs inside animation frames and confirms actual roof contact. A regression also prevents releasing thrust at a ledge from rearming coyote through the previous ground contact; disabled mode remains unchanged. WebKit testing found that rewriting the pressed button label during focusout cancelled its click. The UI now preserves unchanged label text; an isolated message trace and both full matrices confirm the mode request and baseline. Backward-tab coverage permits the native button/arena tab-order difference between engines while checking that Shift does not consume navigation.

The 60-second jet rehearsal completed one reset/rejoin and heap capture but failed the separate ordinary-correction gate: worst post-warm-up p95 0.133333 units, versus <0.08. Thrust p95 was zero and overall p95 0.001271 units. Early RTT reached 290.7 ms while the separate final check was also running; subsequent samples settled. This is retained as failed evidence, not acceptance. The full run uses the same code and thresholds, the normal five-minute warm-up, and no concurrent validation workloads. Rehearsal evidence: `artifacts/playground-jets-v1-soak-60s-1788205531488/`.

## Timestamp mapping prerequisite: passed

Build `playground-timing-v2`, protocol 3, content `playground-2`, trace 2. The repaired clock ages baselines through ping-derived monotonic offsets. The deterministic delayed-baseline case has zero late commands and correction p95 zero, versus 368 late commands and 0.40 p95 with the old mapping. Baseline delays 0/50/150 ms, frame phases 0/8/16 ms, latency growth and short/long stalls pass. The failing controls remain reproducible.

Formatting, types, package boundaries, 36 Bun tests (467 assertions), compatibility initialization/restoration and the 900-tick replay pass. Preview and development each pass all 30 Chromium/Firefox/WebKit tests, including a live 150 ms delayed reset baseline. CI now runs both modes; remote execution remains unverified.

Full soak: **18:47:46–19:17:50 UTC, 31 August 2026**, 1,800.94 seconds, 30 resets and 30 rejoins. Every automated gate passed. Source fingerprint `bf027ad8aae63e4be8af70ccf8636043f52a8c2ecef6d4afca91ef5cbd95513b` remained unchanged.

| Measure | Worst sampled post-warm-up value |
| --- | --- |
| Server work p95 / p99 | 1.777 / 2.403 ms |
| Correction p95 | **0 units** |
| Upstream / downstream | 4.608 / 29.074 kB/s per player |
| Server RSS median growth | 0.078 MiB |
| Prediction / remote history maximum | 16 ticks / 40 snapshots |
| Scene objects / geometries / programs | 13 / 8 / 2, stable |

No errors or overruns; 340 expired commands across the entire run, largest individual correction 0.55 units. Zero p95 is not a claim that all individual corrections were zero. The test used two isolated headless Chromium 151.0.7922.34 processes, Bun 1.4.0, 1440×1000, routine 100 ms added RTT, arm64 macOS 26.6.2 with ten logical CPUs. Headless timing is not a real-display benchmark.

Retained-memory investigation used opt-in Chromium garbage collection every five minutes, with heap snapshots at minute five and the end. All profiling-induced timing remained in the measurements. P1 retained JavaScript heap ranged 5,243,312–5,392,708 bytes (146 KiB range); intermediate samples plateaued around 5.30–5.31 MB. P2 ranged 7,165,972–7,220,404 bytes. Array-buffer/external backing storage stayed around 2.68 MB. P1 retained one document, 200 DOM nodes and 48 listeners; P2 one document, 199–205 nodes and 48 listeners. Both snapshots report zero detached nodes. Native socket, document and WebGL-context counts stayed at one. The small object changes include browser performance metadata and wrappers for existing DOM elements; no accumulating gameplay entities were found.

The process observer recorded first/last-third post-warm-up browser RSS medians of 1,400.38 / 1,407.47 MiB (+7.09 MiB), within a 1,358.48–1,559.56 MiB range. Snapshotting itself raised process memory, and RSS sums shared pages. Retained profiles and stable resource counts support proceeding with the bounded prototype; they do not prove all native browser caches or production workloads leak-free. No speculative memory/rendering patch was added.

Evidence: `artifacts/playground-timing-v2-soak-1800s-1788202066771/` contains the full report, timing analysis, heap samples/snapshots/summaries, process observer, environment and browser matrices. `pre-jet-movement.json` freezes the existing fixture and jump outcomes for disabled-mode comparison. The approved jet experiment can now proceed. Installed-browser manual checks, real-display performance and remote CI remain unverified.

## Historical first timing prerequisite: acceptance failed

Build `playground-timing-v1`, protocol 3, content `playground-2`, trace 2. Movement, rendering, dependency versions, server deadlines, prediction retirement, and the 2–12-tick lead bound are unchanged. Lead may now grow using later RTT samples. Per-player input outcomes, bounded timing records, and local analysis commands are added.

The approved plan explicitly gates jets on successful timing acceptance. The new soak exceeded the correction budget at minute 21; **jet simulation, fuel, Shift controls, room rules/toggle, roof, and jet UI have not been implemented**. The full run completed: 1,800.28 seconds, 30 resets and 30 leave/rejoin cycles, with no errors or server overruns. It failed only the correction gate.

Final soak: 17:25:16–17:55:19 UTC on 31 August 2026. Source fingerprint `3521986c094a7f7fd1ccc84bacb8a5ea932024c4c2b8583c967f3229e724089b` stayed unchanged. Two isolated headless Chromium 151.0.7922.34 processes used the routine 100 ms added-RTT preset.

| Measure | Worst sampled post-warm-up result | Gate |
| --- | --- | --- |
| Server work p95 / p99 | 1.758 / 2.488 ms | ≤8 / ≤12: pass |
| Correction p95 | **0.133333 units** | **<0.08: fail** |
| Upstream / downstream per player | 4.607 / 29.071 kB/s | ≤8 / ≤64: pass |
| Server RSS median growth | 0.15625 MiB | <32 MiB alarm: pass |
| Scene objects / geometries / programs | 13 / 8 / 2 throughout | Stable: pass |
| Maximum prediction / remote history | 15 ticks / 40 snapshots | ≤120 / ≤40: pass |
| Maximum incoming / outgoing delay queue | 5 / 5 | ≤256 each: pass |

All 360 sampled states contained two players. There were 1,959 expired input commands. The largest individual correction was 0.611237 units; RTT ranged 114.5–221.1 ms. Headless frame p95 reached 18.2 ms, which is not a real-display frame measurement. Final rolling correction p95 returned to zero as the failed epoch aged out; this does not erase the earlier failure.

The separate browser-process observer captured 50 post-warm-up samples. First/last-third RSS medians were 1,239.58 / 1,249.97 MiB, an increase of 10.39 MiB; the range was 1,226.77–1,274.20 MiB. RSS includes shared pages and native allocations, not just retained JavaScript objects. This does not clear the existing browser-memory investigation; retained-heap profiling remains open. The passing automated memory gate measures server RSS only. Server RSS during the last ten minutes was 106.031–106.047 MiB. The observer and soak processes exited normally.

Formatting, strict types, package boundaries and all 34 Bun unit/integration tests passed (237 assertions). Compatibility initialization/restoration and the 900-tick replay passed. Built-preview Playwright passed all 27 Chromium/Firefox/WebKit workflows. Final development Playwright also passed all 27 Chromium/Firefox/WebKit workflows. Both matrices had no skips or flaky results. Reports are copied into the timing soak directory. The build retains the existing Rapier bundle-size advisory.

No new installed-Chrome/Firefox/Safari manual smoke test or real-display measurement was performed. Playwright's browser engines are the automated coverage, not proof of installed-browser or human playtest acceptance. Remote CI remains unverified; its workflow now also writes the deterministic timing evidence.

Deterministic evidence (`bun tools/timing.ts`):

| Scenario | Late commands | Correction p95 | Result |
| --- | --- | --- | --- |
| Frozen lead, delay grows from 50 to 100 ms per direction | 798; 691 after settling | 0.4000005 units | Reproduces insufficient lead |
| Bounded lead updates, same delay increase | 13; zero after settling | 0 | Fixes this case |
| Bounded lead updates, baseline alone delayed 50 ms | 368; 158 after settling | 0.4000000 units | **Unresolved clock-mapping failure** |

These use the real shared simulation, room and prediction under a virtual monotonic clock. They vary phase, seeded jitter, latency growth, and 40/180/1,000-ms stalls. The known-failure unit assertion is deliberately labelled “unresolved reproduction”; a passing test confirms reproducibility, not acceptance.

Live evidence identifies P1 epoch 163 around 1,225–1,280 seconds. Its 3,589 correlated inputs include 939 late commands; 272 of 1,198 corrections exceed 0.08 units. Adjacent P1 epochs 155 and 171 each had zero observed late commands. Their outgoing delay p95 values are similar (74.4 / 73.6 / 73.6 ms), but the middle epoch has an inferred mapping residual of +2.95 ticks, compared with approximately zero in its neighbours. P2 was unaffected during that interval.

The residual is `receivedTick - estimatedServerTickAtGeneration - browserQueueDelay/TICK_MS`. It includes loopback transport, dispatch and tick quantization; it is not a direct measurement of clock offset. No browser/server clock origins are subtracted. This narrows the failure to an epoch-specific timing problem and is consistent with the deterministic delayed-baseline reproduction, but does not reconstruct the exact delivery delay of that live baseline.

Local case evidence: `artifacts/playground-timing-v1-soak-1800s-1788197116489/clock-bias-case.json`, `timing.jsonl`, and `timing-analysis.json`. Deterministic reports: `artifacts/timing-1788198486616/`. Receipt tails may omit burst traffic; captured timing logs are bounded observations rather than a lossless transport trace. Keep original failed-run evidence below for comparison.

## Jump-forgiveness build: playtest passed, performance acceptance open

Build `playground-jump-forgiveness-v1`, protocol 2, content `playground-2`, trace 2. Dependencies are unchanged.

The user reported **“The playtest passed” on 31 August 2026**. Human playtest acceptance is recorded; retain the six-tick coyote and buffer windows. Browser/preset coverage and quantitative measurements were not separately supplied. This does not clear the automated correction-budget failure or the browser-memory investigation.

- Formatting, strict TypeScript, package boundaries: passed.
- Bun unit/integration: 28 tests, 188 assertions passed, including exact coyote/buffer boundaries, mid-window restoration, repeat/refresh behavior, authoritative retirement, suspension, strict version/counter validation, and consistent two-player overrun baselines.
- Bun compatibility gate and 900-tick replay: passed. A standalone landing trace replayed; a version-1 trace failed with the explicit incompatibility error.
- Final built-preview Playwright: 27 passed in Chromium, Firefox and WebKit (102.45 seconds; no skips or flaky tests). Boundary traces compare x/y/vx/vy within 0.0001 and grounded/counters exactly. Downloaded diagnostic exports are validated and replayed through the Bun CLI.
- Final development Playwright: 27 passed in Chromium, Firefox and WebKit (110.33 seconds; no skips or flaky tests). Both matrices include two participants through every latency preset and assert empty prediction history while paused.
- The first soak was deliberately interrupted after nine resets/rejoins when correction p95 exceeded 0.08 after warm-up. Its local report is retained at `artifacts/playground-jump-forgiveness-v1-soak-1800s-1788184937242/report.json`; `Server exited during soak` records the deliberate shutdown, not an unexplained crash. The source hash was `a900ebeb6ec18dafb323f22e3b5fd046f9879eaae5b6cc548f460cca0eff267a`. This interrupted run is not counted as the full-duration test.
- An isolated three-minute control of unchanged commit `8662cf4` passed its rehearsal gates (three resets/rejoins, correction p95 approximately 0, server work p95/p99 1.71/2.19 ms). Its sampled RTT was 119–160 ms, so it did not reproduce the failed run's larger timing spikes and does not prove their cause. Report: `artifacts/jump-forgiveness/unchanged-playground-control-180s.json`.
- Two automation races were corrected: reading a later diagnostic state after observing movement, and programmatically clicking Reset before the second page enabled it. Neither required a runtime change. Earlier failure reports remain in `artifacts/jump-forgiveness/`.

The earlier measurements below describe the original playground, not this build. Human jump-forgiveness feedback is now recorded as a pass; specific installed-browser coverage and display measurements remain unverified. The user confirmed the original playground ran smoothly directly on the machine; its apparent stickiness came from remote screen access. The reverted rendering patch remains absent.

## Jump-forgiveness full-duration result

**The soak completed but failed performance acceptance.** Do not mark this slice fully accepted: the existing correction threshold remains unchanged and was exceeded. The implementation, automated correctness checks and user-reported playtest pass; specific installed-browser/display checks and correction-budget sign-off remain open.

Run: 14:22:20–14:52:24 UTC on 31 August 2026. Duration: 1,800.24 seconds. Thirty resets and thirty leave/rejoin cycles completed, no errors or server overruns. All 360 sampled states contained two players, with bounded histories and queues. The source hash remained `a900ebeb6ec18dafb323f22e3b5fd046f9879eaae5b6cc548f460cca0eff267a`, identical to the interrupted rehearsal; no timing or rendering workaround was added between runs.

| Measure | Worst sampled post-warm-up result | Gate |
| --- | --- | --- |
| Server work p95 / p99 | 1.762 / 2.363 ms | ≤8 / ≤12 ms: pass |
| Correction p95 | **0.133336 units** | **<0.08: fail** |
| Upstream / downstream per player | 4.606 / 15.534 kB/s | ≤8 / ≤64: pass |
| Server RSS median growth | 0.03125 MiB | <32 MiB alarm: pass |
| Scene objects / geometries / programs | 13 / 8 / 2 throughout | Stable: pass |
| Maximum prediction / remote history | 16 ticks / 40 snapshots | ≤120 / ≤40: pass |
| Maximum incoming / outgoing delayed queue | 4 / 5 messages | ≤256 each: pass |

The failed rolling correction samples were concentrated around 510–710 seconds in P1. Late-input counts rose quickly during that interval; 2,101 late inputs were retired over the run. The largest individual correction was 0.611238 units. Sampled RTT ranged from 107.6–186.2 ms (including the 100 ms added-RTT preset). Headless frame p95 peaked at 17.7 ms; these are not real-display measurements. The first interrupted rehearsal had larger RTT spikes, up to 309.6 ms.

In that build, the client fixed its tick mapping and prediction lead on each baseline; subsequent pings updated RTT diagnostics but did not adjust the mapping or lead. The late-input burst is consistent with insufficient prediction lead or baseline timing error, but these measurements do not conclusively isolate its cause or establish whether it predates this change. The short unchanged-code control had a narrower RTT range and cannot settle that question. A focused timing investigation is the next acceptance action; do not relax the budget or reinstate the reverted rendering patch to claim success.

Server RSS was 111.266–111.281 MiB during the final ten minutes. The separate read-only browser-process observer collected 72 post-warm-up samples: first/last-third RSS medians were 1,185.69 / 1,212.91 MiB, a 27.22 MiB increase. Its late-window median was 1,213.26 MiB with substantial fluctuation and page/process replacement. RSS may double-count shared pages and is not retained JavaScript heap size. These observations do **not** establish the stronger claim of no continuing browser-memory growth; heap profiling remains needed if the trend reproduces. The harness's memory gate measures server RSS only.

Local evidence: `artifacts/playground-jump-forgiveness-v1-soak-1800s-1788186140681/report.json`, `browser-memory.json`, `player-1.png`, and `player-2.png`. Observer source: `artifacts/jump-forgiveness/observe-memory.py`. Reusable version-2 landing trace: `artifacts/jump-forgiveness/landing-trace.json`. Earlier browser reports and test-race failures are retained in `artifacts/jump-forgiveness/`; final full matrices remain `artifacts/e2e-preview.json` and `artifacts/e2e-dev.json`.

Installed versions were rechecked: Chrome 150.0.7871.187, Firefox 147.0.1 and Safari 26.6.2. The user subsequently reported a passed playtest; specific installed-browser coverage was not supplied. The automated checks used Playwright’s own Chromium/Firefox/WebKit binaries, not an agent-run installed-browser smoke test. Remote CI for this change has not been verified. All test servers and the memory observer were stopped after the run.

## Original playground validation (historical)

### Verified

- Bun 1.4.0 Rapier initialization/restoration and the 900-tick replay fixture passed.
- Browser replay matches Bun within 0.0001 units in development and built preview.
- Strict TypeScript, source formatting and package-boundary checks passed.
- 16 unit/integration tests passed (72 assertions), including live admission, malformed/future/oversized traffic, discarded-baseline recovery, delayed-queue ordering/clearing/overflow, wall-contact falling and server restart.
- Built preview: 21 Playwright scenarios passed, zero failures/skips/flaky tests (83.6 seconds).
- Vite development: the same 21 scenarios passed, zero failures/skips/flaky tests (89.4 seconds).
- Each matrix covers Chromium, Firefox and WebKit: replay, rendering/resize, two-player admission/movement, third rejection, reset/rejoin, latency/prediction/correction, blur/stall, export, reload, repeated latency changes during initial handshake, a canceled-hello regression, and a deliberate WebGL2 failure. The delayed-input checks observe local movement while the authoritative position is still unchanged.
- Visibility recovery is exercised with a synthetic `visibilitychange` and overridden visibility state. This verifies the application's handler; it is not evidence of real operating-system background-tab scheduling.
- A separate 100-connection probe admitted only eight pending sockets. Running server and Vite listeners were observed on loopback, not all interfaces.
- The final full-duration soak passed all gates: 1,800.26 seconds, 30 resets and 30 leave/rejoin cycles, no errors, no server overruns, bounded histories/queues and constant renderer resource counts.
- Earlier failed/interrupted evidence is retained separately: the reconnect failure (`artifacts/soak-1800s-attempt1.json`), a startup failure, and the twelve-cycle run deliberately stopped for the canceled-hello fix (`artifacts/soak-1800s-interrupted-for-handshake-fix.json`). These are not counted as successful full-duration runs.
- A fresh temporary copy passed frozen-lockfile offline installation, formatting/type/boundary checks, unit/integration tests and production build. Startup against an occupied backend port now exits with status 1 and leaves no Vite listener behind.

The deliberate unsupported-WebGL2 scenario logs a renderer error while displaying the expected user-facing fallback. The production build retains a bundle-size advisory: approximately 942 kB compressed JavaScript plus 2 kB CSS, with Rapier WASM embedded. Neither is an unreported test failure.

### Thirty-minute measurements

Run: 08:37:11–09:07:14 UTC on 31 August 2026. Source fingerprint: `db15b3f8979513566556bdd65fce8db0ff82f3208799a5f55248a6c3edba83ca`. The report confirms that implementation sources did not change during the run. Statistics below use the worst sampled rolling percentiles or connection averages after five minutes of warm-up, rather than claiming one whole-run percentile from raw tick samples.

| Measure | Observed | Provisional gate |
| --- | --- | --- |
| Server work p95 / p99 | 1.71 / 2.02 ms | ≤8 / ≤12 ms |
| Movement correction p95 | 0.0000 units | <0.08 units |
| Upstream / downstream per player | 4.62 / 13.27 kB/s | ≤8 / ≤64 kB/s |
| Server RSS median growth after warm-up | 0.234 MiB | <32 MiB investigation alarm |
| Scene objects / GPU geometries / programs | 13 / 8 / 2 throughout sampled normal rendering | No increasing count |
| Maximum prediction / remote history | 16 ticks / 40 snapshots | ≤120 / ≤40 |
| Maximum incoming / outgoing delay queue | 4 / 5 messages | ≤256 each |

All 360 sampled states contained two players. The server input queue reached nine entries. There were 513 expired input commands, which were discarded; they did not advance time or revive old jumps. Zero p95 correction does not mean zero individual corrections: the largest recorded correction was 0.267 units, and the worst sampled p99 was 0.133 units. Actual measured RTT ranged from 106.5 to 235.9 ms under the 100 ms added-RTT preset, including browser scheduling overhead.

Server RSS stayed between 108.672 and 108.688 MiB during the last ten minutes. An independent read-only process observer sampled the test-owned browser process subtree for the final 23.5 minutes. Its first/last-third medians were 1,184.50 / 1,185.42 MiB, with a fluctuating range of 870.89–1,231.88 MiB across samples with both browser process groups present. Process counts remained seven or eight as pages were replaced. RSS sums can double-count shared pages; these figures are not per-player JavaScript heap sizes or a production client-memory budget. No sustained upward trend was observed in this window; that does not prove every possible leak absent.

Headless frame p95 reached 17.5 ms in the worst sample and ended at 9.8 ms in both clients. These are separate observations, not real-display frame measurements or a low-end GPU certification.

The final screenshots revealed label clipping at the arena boundary. After the soak, one presentation-only line was changed to clamp label placement inside the arena. Boundary assertions were added to the browser suite. The simulation, protocol, transport, prediction and timing code are unchanged from the full-duration run; the 30-minute soak was not repeated for this cosmetic change. Reverting only that line in the fingerprint calculation reproduces the exact soaked-source hash (`artifacts/final-source-verification.json`); the final source hash is `6f09742575e619c3f543dd1b9f1497acc1c94cc0da888ef54cae68b879bb0047`. The browser test results above are refreshed separately for the final presentation code.

### Reference environment

Apple M1 Max, 10 logical CPU cores, 64 GiB RAM, macOS 26.6.2 (25G83), Bun 1.4.0. Playwright 1.62.1 uses Chromium 151.0.7922.34, Firefox 153.0 and WebKit 26.5. Browser workflows use a 1440×1000 viewport. The soak uses two isolated headless Chromium processes and the 100 ms added-RTT preset with bounded seeded jitter.

Installed browser versions were inspected: Chrome 150.0.7871.187, Firefox 147.0.1, Safari 26.6.2. These are **not** the same as the automated browser binaries. Manual installed-browser checks have not been completed: the requested Chrome browser connection was unavailable. No workaround was used to control that browser. Real Safari, display refresh behaviour and representative low-end GPU performance remain unverified.

### Evidence and limits

Generated reports are local and ignored by version control: `artifacts/e2e-preview.json`, `artifacts/e2e-dev.json`, browser screenshots, `artifacts/soak-1800s.json`, and `artifacts/soak-process-memory.json`. The process observer's source is retained as `artifacts/observe-memory.py`. The soak records the tested source fingerprint and checks that implementation sources remain unchanged during its run. Use the report for measured values; do not treat the concept document's budgets as measurements. Both soak listeners and its observer exited after completion.

At the time of the original validation, no Git repository or remote existed. They are now configured; remote CI for the jump-forgiveness change remains unverified. No deployment or online endpoint was created. No simultaneous two-human playtest or transport-level packet-loss test was performed. The Colyseus, advanced physics and auth/database investigations remain deferred.
