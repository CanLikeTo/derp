# Jet experiment playtest

Status: **pending human playtest**. Start `bun run dev`, connect two windows at `http://127.0.0.1:5173`, and test directly on the computer. The server starts with jets off. Click **Enable jets · resets both players**; either player can change the shared mode.

1. Hold either Shift key for a short burst. Fuel lasts 0.75 seconds of thrust. Releasing Shift removes acceleration but keeps upward momentum.
2. Exhaust the fuel and keep Shift held through landing: it must stay empty. Release both Shift keys on the ground to refill. Try holding both and releasing only one.
3. Combine Space and Shift. Test the low ceiling and the room roof, and hold into a wall. Labels should stay visible. Ceiling contact still spends fuel.
4. Compare ordinary jumps with jets off/on. Are short bursts useful without making platforms, landing and normal jumps irrelevant?
5. Repeat under the 100 ms and 200 ms added-RTT presets. Local fuel/movement should respond before delayed server confirmation; the other window should show the historical `JET` marker with its pose.
6. Switch focus while thrusting, reset, reconnect, and toggle jets from the other window. There should be no stale thrust. Reset preserves mode; restarting Bun disables jets.
7. Use the mode button with Tab/Enter. Shift+Tab must still navigate normally. The button and Reset share a brief cooldown.
8. Export diagnostics after a surprise and record the build, browser/OS, preset, steps and expected behavior. Replay the pending-input trace with `bun run replay path/to/export.json`.

Decision: **keep, revise or remove jets** before combat. Record whether fuel/refill is clear, the burst feels controllable, ordinary jumps remain useful, and the remote indicator reads correctly. This is not a maximum-player, real-network or low-end performance test.

---

# Jump-forgiveness playtest

Status: **passed, as reported by the user on 31 August 2026**: “The playtest passed.” This records human acceptance of the jump-forgiveness playtest. Specific browser/preset coverage, measurements and a simultaneous two-human session were not separately reported. The subsequent timing repair passed its full soak and retained-memory investigation; see `VALIDATION.md`.

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
