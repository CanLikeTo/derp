import { beforeAll, expect, test } from "bun:test";
import {
  initializePhysics,
  Simulation,
  replay,
  NEUTRAL,
  MOVEMENT,
} from "@derp/simulation";
import { jumpTraces } from "../fixtures/jumps";
import { Controls } from "../../apps/client/src/input";
beforeAll(initializePhysics);

test("coyote arms after walk-off, accepts W+6 and rejects W+7", () => {
  const traces = jumpTraces();
  const last = replay(traces.coyoteLast!),
    expired = replay(traces.coyoteExpired!);
  expect(last[0]!.grounded).toBe(false);
  expect(last.slice(0, 6).map((s) => s.coyoteTicksRemaining)).toEqual([
    6, 5, 4, 3, 2, 1,
  ]);
  expect(last.at(-1)!.vy).toBe(11.5);
  expect(last.at(-1)!.coyoteTicksRemaining).toBe(0);
  expect(expired[6]!.coyoteTicksRemaining).toBe(0);
  expect(expired.at(-1)!.vy).toBeLessThan(0);
});
test("buffer accepts contact on P and P+5, expires before P+6", () => {
  const traces = jumpTraces();
  const now = replay(traces.landingNow!),
    last = replay(traces.landingLast!),
    expired = replay(traces.landingExpired!);
  expect(now[0]!.vy).toBe(MOVEMENT.jump);
  expect(now[0]!.grounded).toBe(false);
  expect(now[0]!.y).toBeCloseTo(0.9101, 3);
  expect(now[1]!.y).toBeGreaterThan(now[0]!.y);
  expect(last.slice(0, 5).map((s) => s.jumpBufferTicksRemaining)).toEqual([
    5, 4, 3, 2, 1,
  ]);
  expect(last[5]!.vy).toBe(MOVEMENT.jump);
  expect(last[5]!.jumpBufferTicksRemaining).toBe(0);
  expect(expired[5]!.jumpBufferTicksRemaining).toBe(0);
  expect(expired[6]!.grounded).toBe(true);
  expect(expired.every((s) => s.vy <= 0)).toBe(true);
});
test("launch never rearms coyote; walls and ceilings grant no eligibility", () => {
  const traces = jumpTraces();
  const air = replay(traces.secondAirPress!);
  expect(air[0]!.coyoteTicksRemaining).toBe(0);
  expect(air[1]!.vy).toBe(11);
  for (const name of ["secondAirPress", "ceiling", "wall"]) {
    const states = replay(traces[name]!);
    expect(states.every((s) => s.coyoteTicksRemaining === 0)).toBe(true);
    expect(states.at(-1)!.grounded).toBe(true);
  }
});
test("short released tap survives until landing; held or repeat Space never chains jumps", () => {
  for (const release of [true, false]) {
    const sim = new Simulation(),
      controls = new Controls();
    let state = jumpTraces().landingLast!.initial;
    controls.press("Space");
    if (release) controls.release("Space");
    let launches = 0;
    for (let tick = 0; tick < 100; tick++) {
      if (!release) controls.press("Space", true);
      const next = sim.step(state, controls.sample(), { jetsEnabled: false });
      if (next.vy > 0 && state.vy <= 0) launches++;
      state = next;
    }
    expect(launches).toBe(1);
    expect(state.grounded).toBe(true);
    sim.dispose();
  }
});
test("mid-window restoration replaces disturbed collider state and restores both counters", () => {
  for (const name of ["coyoteLast", "landingLast"]) {
    const trace = jumpTraces()[name]!,
      expected = replay(trace),
      sim = new Simulation();
    let state = { ...expected[1]! };
    expect(
      state.coyoteTicksRemaining + state.jumpBufferTicksRemaining,
    ).toBeGreaterThan(0);
    sim.step({ ...state, x: -11, y: 10 }, NEUTRAL, { jetsEnabled: false });
    for (const input of trace.inputs.slice(2))
      state = sim.step(state, input, { jetsEnabled: false });
    expect(state).toEqual(expected.at(-1)!);
    sim.dispose();
  }
});

test("a new edge refreshes one buffer slot without queuing multiple landing jumps", () => {
  const sim = new Simulation();
  let state = jumpTraces().landingExpired!.initial;
  let launches = 0;
  for (let tick = 0; tick < 100; tick++) {
    const next = sim.step(
      state,
      { ...NEUTRAL, jumpPressed: tick === 0 || tick === 4 },
      { jetsEnabled: false },
    );
    if (tick === 4) expect(next.jumpBufferTicksRemaining).toBe(5);
    if (next.vy > 0 && state.vy <= 0) launches++;
    state = next;
  }
  expect(launches).toBe(1);
  expect(state.grounded).toBe(true);
  sim.dispose();
});
