import { beforeAll, expect, test } from "bun:test";
import {
  initializePhysics,
  Simulation,
  replay,
  NEUTRAL,
  JETS,
  spawnState,
} from "@derp/simulation";
import {
  parseClient,
  parseTrace,
  validPlayer,
  validRules,
  emptyInputTiming,
  type StateMessage,
} from "@derp/protocol";
import { jetTraces } from "../fixtures/jets";
import { Controls } from "../../apps/client/src/input";
import { Room } from "../../apps/server/src/room";
import { Prediction, Interpolation } from "../../apps/client/src/prediction";
beforeAll(initializePhysics);
const on = { jetsEnabled: true };
const stats = {
  tickP95: 0,
  tickP99: 0,
  scheduleMs: 0,
  overruns: 0,
  lateInputs: 0,
  connections: 1,
  queuedInputs: 0,
  rssMB: 0,
  inBytes: 0,
  outBytes: 0,
  projectiles: 0,
  shots: 0,
  terrainImpacts: 0,
  playerImpacts: 0,
  expiredProjectiles: 0,
  capacityDrops: 0,
};

test("exactly 45 thrust ticks; exhaustion held on the ground cannot refill or relaunch", () => {
  const states = replay(jetTraces().exhaust!);
  for (let tick = 0; tick < 45; tick++) {
    expect(states[tick]!.jetActive).toBe(true);
    expect(states[tick]!.jetFuelTicksRemaining).toBe(44 - tick);
  }
  expect(states[44]!.jetActive).toBe(true);
  expect(states[45]!.jetActive).toBe(false);
  expect(states[239]!.grounded).toBe(true);
  expect(
    states
      .slice(45, 240)
      .every((s) => s.jetFuelTicksRemaining === 0 && !s.jetActive),
  ).toBe(true);
  for (let tick = 240; tick < 285; tick++)
    expect(states[tick]!.jetFuelTicksRemaining).toBe(tick - 239);
  expect(states.at(-1)!.jetFuelTicksRemaining).toBe(JETS.fuelTicks);
});

test("release removes thrust acceleration, preserves momentum and grants no airborne recharge", () => {
  const states = replay(jetTraces().release!);
  expect(states[9]!.vy).toBe(2.5);
  expect(states[10]!.vy).toBe(2);
  expect(states[10]!.jetActive).toBe(false);
  expect(states[10]!.jetFuelTicksRemaining).toBe(35);
});

test("jump then thrust respects cap, coyote eligibility, landing buffer and roof containment", () => {
  const traces = jetTraces();
  for (const name of ["combined", "coyote"]) {
    const states = replay(traces[name]!);
    expect(states[0]!.vy).toBe(12);
    expect(states[0]!.coyoteTicksRemaining).toBe(0);
    expect(states[0]!.jetFuelTicksRemaining).toBe(44);
    expect(
      states.every((s) => s.vy <= 12 && s.y <= 12.091 && s.x <= 11.591),
    ).toBe(true);
  }
  const buffered = replay(traces.buffer!);
  expect(buffered[0]!.vy).toBe(12);
  expect(buffered[0]!.grounded).toBe(false);
  expect(buffered[0]!.jumpBufferTicksRemaining).toBe(0);
  expect(buffered[0]!.jetFuelTicksRemaining).toBe(44);
  for (const name of ["roof", "wall"]) {
    const states = replay(traces[name]!);
    expect(
      states.every((s) => s.y <= 12.091 && s.x <= 11.591 && s.x >= -11.591),
    ).toBe(true);
    expect(states[0]!.jetFuelTicksRemaining).toBe(44);
  }
  expect(replay(traces.roof!)[0]!.vy).toBe(0);
});

test("thrust alone clears coyote, does not consume landing buffer, disabled mode ignores held jets", () => {
  const sim = new Simulation();
  try {
    const initial = {
      ...spawnState("a", 2),
      y: 5,
      coyoteTicksRemaining: 6,
      jumpBufferTicksRemaining: 0,
    };
    const next = sim.step(initial, { ...NEUTRAL, jetHeld: true }, on);
    expect(next.coyoteTicksRemaining).toBe(0);
    const buffered = sim.step(
      { ...initial, coyoteTicksRemaining: 0, jumpBufferTicksRemaining: 5 },
      { ...NEUTRAL, jetHeld: true },
      on,
    );
    expect(buffered.jumpBufferTicksRemaining).toBe(4);
    const trace = jetTraces().disabled!;
    expect(replay(trace)).toEqual(
      replay({
        ...trace,
        inputs: trace.inputs.map((i) => ({ ...i, jetHeld: false })),
      }),
    );
    expect(
      replay(trace).every(
        (s) => s.jetFuelTicksRemaining === 45 && !s.jetActive,
      ),
    ).toBe(true);
  } finally {
    sim.dispose();
  }
});

test("restoration and reconciliation preserve fuel and retire thrust commands exactly once", () => {
  const trace = jetTraces().combined!,
    expected = replay(trace),
    sim = new Simulation(),
    prediction = new Prediction();
  try {
    sim.step({ ...trace.initial, x: -11, y: 8 }, NEUTRAL, on);
    let state = expected[12]!;
    for (const input of trace.inputs.slice(13))
      state = sim.step(state, input, on);
    expect(state).toEqual(expected.at(-1)!);
    const baseline: StateMessage = {
      type: "baseline",
      tick: 0,
      serverTime: 0,
      playerId: trace.initial.id,
      inputEpoch: 1,
      roomGeneration: 1,
      eventCursor: 0,
      projectiles: [],
      players: [trace.initial],
      rules: on,
      stats,
      inputTiming: emptyInputTiming(),
      reason: "test",
    };
    prediction.baseline(baseline, 0);
    for (const input of trace.inputs.slice(0, 15)) prediction.advance(input);
    prediction.state!.x += 1;
    prediction.state!.jetFuelTicksRemaining = 45;
    prediction.reconcile({
      ...baseline,
      type: "snapshot",
      tick: 10,
      players: [expected[9]!],
    });
    expect(prediction.state).toEqual(expected[14]!);
    expect([...prediction.history.keys()]).toEqual([11, 12, 13, 14, 15]);
    expect(prediction.trace()!.inputs.every((i) => i.jetHeld)).toBe(true);
    expect(parseTrace(prediction.trace()).rules).toEqual(on);
    const missing = sim.step(trace.initial, NEUTRAL, on);
    prediction.baseline(baseline, 0);
    prediction.advance({ ...NEUTRAL, jetHeld: true });
    prediction.reconcile({
      ...baseline,
      type: "snapshot",
      tick: 1,
      players: [missing],
    });
    expect(prediction.state).toEqual(missing);
    expect(prediction.history.size).toBe(0);
  } finally {
    sim.dispose();
    prediction.dispose();
  }
});

test("suspend and baseline preserve fuel/momentum; duplicates and epochs add no thrust time", () => {
  const room = new Room();
  try {
    room.rules = on;
    const peer = room.join("a")!;
    peer.state = { ...peer.state, x: 8, y: 6.5 };
    room.baseline("a");
    const input = {
      type: "input" as const,
      inputEpoch: peer.epoch,
      tick: 1,
      ...NEUTRAL,
      jetHeld: true,
    };
    for (let n = 0; n < 50; n++) room.input("a", input);
    expect(room.tick).toBe(0);
    room.step();
    expect(peer.state.jetFuelTicksRemaining).toBe(44);
    room.suspend("a");
    const saved = { ...peer.state };
    room.baseline("a");
    expect(peer.state).toEqual(saved);
    expect(saved.jetActive).toBe(false);
    room.input("a", input);
    room.step();
    expect(peer.state.jetFuelTicksRemaining).toBe(44);
    room.reset();
    expect(peer.state.jetFuelTicksRemaining).toBe(45);
    expect(room.rules).toEqual(on);
    room.leave("a");
    expect(room.join("b")!.state.jetFuelTicksRemaining).toBe(45);
  } finally {
    room.dispose();
  }
});

test("either Shift activates thrust; both must release, and clearing controls removes held intent", () => {
  const controls = new Controls();
  controls.press("ShiftLeft");
  controls.press("ShiftRight");
  expect(controls.sample().jetHeld).toBe(true);
  controls.release("ShiftLeft");
  expect(controls.sample().jetHeld).toBe(true);
  controls.release("ShiftRight");
  expect(controls.sample().jetHeld).toBe(false);
  controls.press("ShiftRight");
  controls.clear();
  expect(controls.sample().jetHeld).toBe(false);
});

test("remote jet marker uses the interpolated interval, never the newest future snapshot", () => {
  const interpolation = new Interpolation();
  const player = spawnState("remote", 2);
  const frame: StateMessage = {
    type: "snapshot",
    tick: 10,
    serverTime: 0,
    playerId: "local",
    inputEpoch: 1,
    roomGeneration: 1,
    eventCursor: 0,
    projectiles: [],
    players: [
      spawnState("local", 1),
      { ...player, jetActive: true, jetFuelTicksRemaining: 10 },
    ],
    rules: on,
    stats,
    inputTiming: emptyInputTiming(),
    reason: "test",
  };
  interpolation.push(frame);
  interpolation.push({
    ...frame,
    tick: 13,
    players: [
      spawnState("local", 1),
      { ...player, x: 9, jetActive: false, jetFuelTicksRemaining: 9 },
    ],
  });
  expect(interpolation.at(11, "local")[0]!.jetActive).toBe(true);
  expect(interpolation.at(13, "local")[0]!.jetActive).toBe(false);
  expect(interpolation.at(100, "local")[0]!.x).toBe(9);
});

test("fuel, rule, input and trace contracts fail closed", () => {
  for (const fuel of [-1, 46, 1.5, NaN])
    expect(
      validPlayer({ ...spawnState("a", 1), jetFuelTicksRemaining: fuel }),
    ).toBe(false);
  expect(
    validPlayer({
      ...spawnState("a", 1),
      jetFuelTicksRemaining: 0,
      jetActive: true,
    }),
  ).toBe(true);
  expect(validRules({ jetsEnabled: true, extra: 1 })).toBe(false);
  expect(() =>
    parseClient(JSON.stringify({ type: "setJets", inputEpoch: 1, enabled: 1 })),
  ).toThrow();
  expect(() =>
    parseClient(
      JSON.stringify({
        type: "input",
        inputEpoch: 1,
        tick: 1,
        moveX: 0,
        jumpPressed: false,
      }),
    ),
  ).toThrow();
  const trace = jetTraces().exhaust!;
  expect(() => parseTrace({ ...trace, version: 2 })).toThrow();
  expect(() => parseTrace({ ...trace, rules: { jetsEnabled: 1 } })).toThrow();
});

test("landing refill requires released intent and never accompanies a buffered launch", () => {
  const sim = new Simulation();
  try {
    const falling = {
      ...spawnState("a", 2),
      x: 8,
      y: 1,
      vy: -10,
      jetFuelTicksRemaining: 0,
    };
    const landed = sim.step(falling, NEUTRAL, on);
    expect(landed.grounded).toBe(true);
    expect(landed.jetFuelTicksRemaining).toBe(1);
    const launch = sim.step(falling, { ...NEUTRAL, jumpPressed: true }, on);
    expect(launch.vy).toBe(12);
    expect(launch.jetFuelTicksRemaining).toBe(0);
    const held = sim.step(falling, { ...NEUTRAL, jetHeld: true }, on);
    expect(held.grounded).toBe(true);
    expect(held.jetFuelTicksRemaining).toBe(0);
    const lift = sim.step(
      {
        ...falling,
        y: 0.9101,
        vy: 0,
        grounded: true,
        jetFuelTicksRemaining: 45,
      },
      { ...NEUTRAL, jetHeld: true },
      on,
    );
    expect(lift.coyoteTicksRemaining).toBe(0);
    expect(
      sim.step(lift, { ...NEUTRAL, jetHeld: true }, on).coyoteTicksRemaining,
    ).toBe(0);
  } finally {
    sim.dispose();
  }
});

test("releasing thrust at a ledge cannot rearm walk-off coyote from the prior contact", () => {
  const sim = new Simulation();
  try {
    const state = {
      ...spawnState("a", 1),
      x: -1.59,
      y: 2.4101,
      grounded: true,
      vy: 0.25,
      jetActive: true,
      jetFuelTicksRemaining: 44,
    };
    const next = sim.step(state, { ...NEUTRAL, moveX: 1 }, on);
    expect(next.grounded).toBe(false);
    expect(next.coyoteTicksRemaining).toBe(0);
    expect(
      sim.step(state, { ...NEUTRAL, moveX: 1 }, { jetsEnabled: false })
        .coyoteTicksRemaining,
    ).toBe(6);
  } finally {
    sim.dispose();
  }
});
