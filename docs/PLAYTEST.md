# First human movement session

Status: not yet performed by two humans. The local automated scenarios do not establish whether movement is enjoyable.

## Setup

Run `bun run dev`, open the local URL in two browser windows, and connect both. Use one focused window at a time; the other shows the remote player. For this stage, do not expose the endpoint to a second machine or the internet.

Start with 0 ms added delay. Repeat with the 100 ms preset, then briefly try 200 ms. The presets add application-level delay/jitter and preserve ordering; they do not model TCP packet loss.

## Main question

Can you understand and trust the relationship between input, movement, collision and what the other window shows?

1. Run into each wall and under the low ceiling. Jump onto and off both ledges.
2. Tap Space very briefly, then hold it. Verify one jump per press.
3. Reverse direction in mid-air. Note whether the deliberately immediate movement feels useful or too abrupt.
4. Watch the remote player while moving the local one. Look for visible stepping or sudden corrections.
5. Enable the debug overlay. The ghost is historical server position, not a direct prediction-error measurement.
6. Switch windows while holding a movement key. Return to the arena and verify there is no stuck movement or surprise jump.
7. Reset with both windows connected, then close/reopen one. Try a third window and verify the rejection is understandable.
8. Export diagnostics after anything confusing. Preserve the scenario and what you expected alongside the JSON.

Record build, browser/OS, window size/display refresh rate, latency preset, issue, reproduction steps, comfort/readability notes and the next decision. Do not use this session to judge weapon balance, low-end performance, WAN fairness or player capacity.

The next movement iteration should decide acceleration/braking, jump feel and traversal variety from these observations before adding combat.
