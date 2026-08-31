# Playground validation — 31 August 2026

## Verified

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

## Thirty-minute measurements

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

## Reference environment

Apple M1 Max, 10 logical CPU cores, 64 GiB RAM, macOS 26.6.2 (25G83), Bun 1.4.0. Playwright 1.62.1 uses Chromium 151.0.7922.34, Firefox 153.0 and WebKit 26.5. Browser workflows use a 1440×1000 viewport. The soak uses two isolated headless Chromium processes and the 100 ms added-RTT preset with bounded seeded jitter.

Installed browser versions were inspected: Chrome 150.0.7871.187, Firefox 147.0.1, Safari 26.6.2. These are **not** the same as the automated browser binaries. Manual installed-browser checks have not been completed: the requested Chrome browser connection was unavailable. No workaround was used to control that browser. Real Safari, display refresh behaviour and representative low-end GPU performance remain unverified.

## Evidence and limits

Generated reports are local and ignored by version control: `artifacts/e2e-preview.json`, `artifacts/e2e-dev.json`, browser screenshots, `artifacts/soak-1800s.json`, and `artifacts/soak-process-memory.json`. The process observer's source is retained as `artifacts/observe-memory.py`. The soak records the tested source fingerprint and checks that implementation sources remain unchanged during its run. Use the report for measured values; do not treat the concept document's budgets as measurements. Both soak listeners and its observer exited after completion.

Remote CI has not run because the workspace has no Git repository or remote. A workflow definition is supplied; no repository, deployment or online endpoint was created. No simultaneous two-human playtest or transport-level packet-loss test was performed. The Colyseus, advanced physics and auth/database investigations remain deferred.
