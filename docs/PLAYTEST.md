# Jump-forgiveness playtest

Status: **passed, as reported by the user on 31 August 2026**: “The playtest passed.” This records human acceptance of the jump-forgiveness playtest. Specific browser/preset coverage, measurements and a simultaneous two-human session were not separately reported. The automated correction-budget failure and browser-memory investigation remain open.

## Setup

Run `bun run dev`, open the local URL in two browser windows, and connect both. Use one focused window at a time; the other shows the remote player. For this stage, do not expose the endpoint to a second machine or the internet.

Start with 0 ms added delay. Repeat with the 100 ms preset, then briefly try 200 ms. The presets add application-level delay/jitter and preserve ordering; they do not model TCP packet loss.

## Main question

Do the six-tick windows reduce missed jumps without introducing unwanted bouncing? Test directly on the computer, not through remote screen sharing.

1. Run into each wall and under the low ceiling. Jump onto and off both ledges.
2. Walk off a raised platform and tap Space just after the edge: the brief coyote window should still jump. Wait noticeably longer and it should not grant an air jump.
3. Tap and release Space just before landing: it should jump on contact even though Space is released. A much earlier tap should expire. Hold Space through the next landing and verify it does not auto-bounce.
4. Reverse direction in mid-air. Note whether the deliberately immediate movement feels useful or too abrupt.
5. Watch the remote player while moving the local one. Look for visible stepping or sudden corrections.
6. Enable the debug overlay. The ghost is historical server position, not a direct prediction-error measurement.
7. Switch windows while holding a movement key. Return to the arena and verify there is no stuck movement or surprise jump.
8. Reset with both windows connected, then close/reopen one. Try a third window and verify the rejection is understandable.
9. Export diagnostics after anything confusing. Preserve the scenario and what you expected alongside the JSON.

Record build, browser/OS, window size/display refresh rate, latency preset, issue, reproduction steps, comfort/readability notes and the next decision. Do not use this session to judge weapon balance, low-end performance, WAN fairness or player capacity.

The next movement iteration should decide acceleration/braking, jump feel and traversal variety from these observations before adding combat.

In **Live diagnostics**, inspect `movement.coyoteTicks`, `movement.jumpBufferTicks`, and the remaining-tick fields in `predicted` and `authoritative`. They age quickly; export immediately after a surprise. The exported trace is bounded pending input, not a recording of the entire session. Save a written reproduction alongside it and replay with `bun run replay path/to/export.json`.

Record separately: missed edge jumps, missed landing taps, unwanted landing launches, ceilings/wall pressure, focus changes during a tap, reset initiated from the other window, and differences across the three latency presets. An already executed jump may continue after focus loss; a new baseline should never generate a stale press.

| Build | Result | Evidence | Environment details | Tuning decision |
| --- | --- | --- | --- | --- |
| playground-jump-forgiveness-v1 | Passed | User report, 31 August 2026 | Browser and presets not separately reported | Keep both windows at six ticks |
