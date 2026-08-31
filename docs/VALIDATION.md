# Playground validation — 31 August 2026

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

The client currently fixes its tick mapping and prediction lead on each baseline; subsequent pings update RTT diagnostics but do not continuously correct that mapping. The late-input burst is consistent with insufficient prediction lead or baseline timing error, but these measurements do not conclusively isolate its cause or establish whether it predates this change. The short unchanged-code control had a narrower RTT range and cannot settle that question. A focused timing investigation is the next acceptance action; do not relax the budget or reinstate the reverted rendering patch to claim success.

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
