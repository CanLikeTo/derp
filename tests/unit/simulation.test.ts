import { beforeAll, expect, test } from "bun:test";
import {
  initializePhysics,
  Simulation,
  spawnState,
  NEUTRAL,
  fixtureTrace,
  replay,
} from "@derp/simulation";
import { Room } from "../../apps/server/src/room";
import { Prediction, Interpolation } from "../../apps/client/src/prediction";
import { Controls } from "../../apps/client/src/input";
import { type StateMessage, emptyInputTiming } from "@derp/protocol";
beforeAll(initializePhysics);
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
test("floor, wall, ceiling and ledge collisions; restoration after teleport", () => {
  const sim = new Simulation();
  let state = spawnState("a", 1);
  for (let i = 0; i < 60; i++)
    state = sim.step(state, NEUTRAL, { jetsEnabled: false });
  expect(state.grounded).toBe(true);
  expect(state.y).toBeCloseTo(0.9101, 3);
  state = sim.step(
    state,
    { ...NEUTRAL, jumpPressed: true },
    { jetsEnabled: false },
  );
  let max = state.y;
  for (let i = 0; i < 60; i++) {
    state = sim.step(state, NEUTRAL, { jetsEnabled: false });
    max = Math.max(max, state.y);
  }
  expect(max).toBeLessThan(2.851);
  expect(max).toBeGreaterThan(2.7);
  expect(state.grounded).toBe(true);
  state = { ...state, x: -4, y: 8, vy: 0 };
  for (let i = 0; i < 120; i++)
    state = sim.step(state, NEUTRAL, { jetsEnabled: false });
  expect(state.y).toBeCloseTo(2.4101, 3);
  state = { ...state, x: 11, y: 0.92, vy: 0 };
  for (let i = 0; i < 60; i++)
    state = sim.step(state, { ...NEUTRAL, moveX: 1 }, { jetsEnabled: false });
  expect(state.x).toBeLessThan(11.601);
  expect(state.x).toBeGreaterThan(11.58);
  sim.dispose();
});
test("replay resumes exactly from a saved state with stale physics state replaced", () => {
  const trace = fixtureTrace(),
    states = replay(trace),
    sim = new Simulation();
  sim.step({ ...trace.initial, x: 10, y: 10 }, NEUTRAL, { jetsEnabled: false });
  let state = states[499]!;
  for (const input of trace.inputs.slice(500))
    state = sim.step(state, input, { jetsEnabled: false });
  expect(state).toEqual(states.at(-1)!);
  sim.dispose();
});

test("holding into a platform side does not cancel falling velocity", () => {
  const sim = new Simulation();
  let state = {
    ...spawnState("wall", 1),
    x: 5.4101,
    y: 2.8,
    vy: 0,
    grounded: false,
  };
  for (let i = 0; i < 60; i++)
    state = sim.step(state, { ...NEUTRAL, moveX: -1 }, { jetsEnabled: false });
  expect(state.y).toBeLessThan(1);
  expect(state.grounded).toBe(true);
  sim.dispose();
});
test("quick press captures one edge; repeat and opposing directions", () => {
  const controls = new Controls();
  controls.press("Space");
  controls.release("Space");
  expect(controls.sample().jumpPressed).toBe(true);
  expect(controls.sample().jumpPressed).toBe(false);
  controls.press("Space");
  controls.sample();
  controls.press("Space", true);
  expect(controls.sample().jumpPressed).toBe(false);
  controls.press("KeyA");
  controls.press("ArrowRight");
  expect(controls.sample().moveX).toBe(0);
  controls.clear();
  expect(controls.sample()).toEqual(NEUTRAL);
});
test("room caps identity, consumes one input per tick, expires jumps and keeps gravity", () => {
  const room = new Room();
  const peer = room.join("a")!;
  room.baseline("a");
  room.join("b");
  expect(room.join("c")).toBeUndefined();
  for (let i = 0; i < 60; i++) room.step();
  const frame = {
    ...NEUTRAL,
    type: "input" as const,
    inputEpoch: peer.epoch,
    tick: room.tick + 1,
    moveX: 1 as const,
    jumpPressed: true,
  };
  for (let i = 0; i < 1000; i++) room.input("a", frame);
  expect(peer.inputs.size).toBe(1);
  expect(room.tick).toBe(60);
  room.step();
  const x = peer.state.x;
  expect(peer.state.vy).toBeGreaterThan(0);
  room.step();
  expect(peer.state.x).toBeCloseTo(x, 5);
  expect(peer.state.vy).toBeLessThan(11.5);
  room.input("a", frame);
  expect(peer.inputs.size).toBe(0);
  expect(() => room.input("a", { ...frame, tick: room.tick + 17 })).toThrow();
  room.suspend("a");
  room.input("a", { ...frame, tick: room.tick + 1 });
  expect(peer.inputs.size).toBe(0);
  const old = peer.epoch;
  room.baseline("a");
  room.input("a", { ...frame, inputEpoch: old, tick: room.tick + 1 });
  expect(peer.inputs.size).toBe(0);
  room.leave("b");
  expect(room.join("c")).toBeDefined();
  room.dispose();
});
test("snapshot tick retires missing inputs, restores and replays pending state", () => {
  const prediction = new Prediction(),
    room = new Room();
  const peer = room.join("a")!;
  room.baseline("a");
  const baseline: StateMessage = {
    rules: { jetsEnabled: false },
    type: "baseline",
    tick: 0,
    serverTime: 0,
    playerId: "a",
    inputEpoch: peer.epoch,
    roomGeneration: 1,
    eventCursor: 0,
    projectiles: [],
    players: room.snapshot(),
    stats,
    inputTiming: emptyInputTiming(),
    reason: "test",
  };
  prediction.baseline(baseline, 0);
  for (let i = 1; i <= 12; i++) {
    const input = prediction.advance({
      ...NEUTRAL,
      moveX: 1,
      jumpPressed: i === 5,
    });
    if (i > 4) room.input("a", input);
  }
  for (let i = 0; i < 8; i++) room.step();
  prediction.state!.x += 1;
  prediction.reconcile({
    ...baseline,
    type: "snapshot",
    tick: room.tick,
    players: room.snapshot(),
  });
  expect(prediction.finalizedTick).toBe(8);
  expect([...prediction.history.keys()]).toEqual([9, 10, 11, 12]);
  for (let i = 0; i < 4; i++) room.step();
  expect(prediction.state).toEqual(peer.state);
  prediction.dispose();
  room.dispose();
});
test("remote interpolation holds instead of extrapolating; histories bounded", () => {
  const buffer = new Interpolation();
  const base: StateMessage = {
    rules: { jetsEnabled: false },
    type: "snapshot",
    tick: 1,
    serverTime: 0,
    playerId: "a",
    inputEpoch: 1,
    roomGeneration: 1,
    eventCursor: 0,
    projectiles: [],
    players: [spawnState("a", 1), spawnState("b", 2)],
    stats,
    inputTiming: emptyInputTiming(),
    reason: "",
  };
  buffer.push(base);
  buffer.push({
    ...base,
    tick: 3,
    players: [base.players[0]!, { ...base.players[1]!, x: 10 }],
  });
  expect(buffer.at(2, "a")[0]!.x).toBe(9);
  expect(buffer.at(10, "a")[0]!.x).toBe(10);
  for (let tick = 4; tick < 100; tick++) buffer.push({ ...base, tick });
  expect(buffer.snapshots.length).toBe(40);
});

test("reconciliation preserves a timely retired buffer but never recreates a missing press", () => {
  for (const delivered of [true, false]) {
    const room = new Room(),
      prediction = new Prediction();
    const peer = room.join("a")!;
    room.baseline("a");
    peer.state = { ...peer.state, x: 8, y: 2, vy: -10 };
    const baseline: StateMessage = {
      rules: { jetsEnabled: false },
      type: "baseline",
      tick: 0,
      serverTime: 0,
      playerId: "a",
      inputEpoch: peer.epoch,
      roomGeneration: 1,
      eventCursor: 0,
      projectiles: [],
      players: room.snapshot(),
      stats,
      inputTiming: emptyInputTiming(),
      reason: "test",
    };
    prediction.baseline(baseline, 0);
    const press = prediction.advance({
      ...NEUTRAL,
      jumpPressed: true,
    });
    if (delivered) room.input("a", press);
    room.step();
    for (let i = 0; i < 5; i++) prediction.advance(NEUTRAL);
    prediction.state!.x += 1;
    prediction.state!.jumpBufferTicksRemaining = 6;
    prediction.state!.coyoteTicksRemaining = 6;
    prediction.reconcile({
      ...baseline,
      type: "snapshot",
      tick: 1,
      players: room.snapshot(),
    });
    expect(prediction.history.has(1)).toBe(false);
    expect(prediction.authoritative!.jumpBufferTicksRemaining).toBe(
      delivered ? 5 : 0,
    );
    expect(prediction.state!.vy > 0).toBe(delivered);
    room.input("a", press); // Retired input must not refresh either branch.
    for (let i = 0; i < 5; i++) room.step();
    expect(prediction.state).toEqual(peer.state);
    prediction.dispose();
    room.dispose();
  }
});
test("suspension cancels pending replay and visual offset while authoritative state stays immutable", () => {
  const prediction = new Prediction(),
    room = new Room();
  const peer = room.join("a")!;
  room.baseline("a");
  peer.state = { ...peer.state, x: 8, y: 2, vy: -10 };
  const base: StateMessage = {
    rules: { jetsEnabled: false },
    type: "baseline",
    tick: 0,
    serverTime: 0,
    playerId: "a",
    inputEpoch: peer.epoch,
    roomGeneration: 1,
    eventCursor: 0,
    projectiles: [],
    players: room.snapshot(),
    stats,
    inputTiming: emptyInputTiming(),
    reason: "test",
  };
  prediction.baseline(base, 0);
  room.input("a", prediction.advance({ ...NEUTRAL, jumpPressed: true }));
  room.step();
  prediction.reconcile({
    ...base,
    type: "snapshot",
    tick: 1,
    players: room.snapshot(),
  });
  const saved = { ...prediction.authoritative! };
  for (let i = 0; i < 6; i++) prediction.advance(NEUTRAL);
  prediction.offset = { x: 0.1, y: 0.1 };
  prediction.cancelPending();
  room.suspend("a");
  expect(prediction.history.size).toBe(0);
  expect(prediction.tick).toBe(prediction.finalizedTick);
  expect(prediction.offset).toEqual({ x: 0, y: 0 });
  expect(prediction.state!.jumpBufferTicksRemaining).toBe(0);
  expect(prediction.authoritative).toEqual(saved);
  for (let i = 0; i < 8; i++) {
    room.step();
    prediction.reconcile({
      ...base,
      type: "snapshot",
      tick: room.tick,
      players: room.snapshot(),
    });
    prediction.cancelPending();
    expect(prediction.tick).toBe(room.tick);
    expect(prediction.history.size).toBe(0);
    expect(prediction.state!.vy).toBeLessThanOrEqual(0);
  }
  prediction.dispose();
  room.dispose();
});
test("fresh epochs and suspend cancel buffered intent without refilling coyote or stopping a launched jump", () => {
  const room = new Room(),
    peer = room.join("a")!;
  room.baseline("a");
  const state = {
    ...peer.state,
    x: 8,
    y: 8,
    vy: -1,
    coyoteTicksRemaining: 4,
    jumpBufferTicksRemaining: 5,
  };
  for (const action of [() => room.suspend("a"), () => room.baseline("a")]) {
    peer.state = { ...state };
    const oldEpoch = peer.epoch;
    room.input("a", {
      ...NEUTRAL,
      type: "input",
      inputEpoch: oldEpoch,
      tick: room.tick + 1,
      moveX: 1,
      jumpPressed: true,
    });
    action();
    expect(peer.inputs.size).toBe(0);
    expect(peer.state).toEqual({ ...state, jumpBufferTicksRemaining: 0 });
  }
  peer.state = {
    ...state,
    vy: 11.5,
    coyoteTicksRemaining: 0,
    jumpBufferTicksRemaining: 0,
  };
  room.suspend("a");
  room.step();
  expect(peer.state.vy).toBe(11);
  expect(peer.state.coyoteTicksRemaining).toBe(0);
  room.reset();
  expect(peer.state).toEqual(spawnState("a", 1));
  room.leave("a");
  expect(room.join("fresh")!.state).toEqual(spawnState("fresh", 1));
  room.dispose();
});
