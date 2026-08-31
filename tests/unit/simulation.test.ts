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
import { type StateMessage } from "@derp/protocol";
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
};
test("floor, wall, ceiling and ledge collisions; restoration after teleport", () => {
  const sim = new Simulation();
  let state = spawnState("a", 1);
  for (let i = 0; i < 60; i++) state = sim.step(state, NEUTRAL);
  expect(state.grounded).toBe(true);
  expect(state.y).toBeCloseTo(0.9101, 3);
  state = sim.step(state, { moveX: 0, jumpPressed: true });
  let max = state.y;
  for (let i = 0; i < 60; i++) {
    state = sim.step(state, NEUTRAL);
    max = Math.max(max, state.y);
  }
  expect(max).toBeLessThan(2.851);
  expect(max).toBeGreaterThan(2.7);
  expect(state.grounded).toBe(true);
  state = { ...state, x: -4, y: 8, vy: 0 };
  for (let i = 0; i < 120; i++) state = sim.step(state, NEUTRAL);
  expect(state.y).toBeCloseTo(2.4101, 3);
  state = { ...state, x: 11, y: 0.92, vy: 0 };
  for (let i = 0; i < 60; i++)
    state = sim.step(state, { moveX: 1, jumpPressed: false });
  expect(state.x).toBeLessThan(11.601);
  expect(state.x).toBeGreaterThan(11.58);
  sim.dispose();
});
test("replay resumes exactly from a saved state with stale physics state replaced", () => {
  const trace = fixtureTrace(),
    states = replay(trace),
    sim = new Simulation();
  sim.step({ ...trace.initial, x: 10, y: 10 }, NEUTRAL);
  let state = states[499]!;
  for (const input of trace.inputs.slice(500)) state = sim.step(state, input);
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
    state = sim.step(state, { moveX: -1, jumpPressed: false });
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
    type: "baseline",
    tick: 0,
    serverTime: 0,
    playerId: "a",
    inputEpoch: peer.epoch,
    players: room.snapshot(),
    stats,
    reason: "test",
  };
  prediction.baseline(baseline, 0);
  for (let i = 1; i <= 12; i++) {
    const input = prediction.advance({ moveX: 1, jumpPressed: i === 5 });
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
    type: "snapshot",
    tick: 1,
    serverTime: 0,
    playerId: "a",
    inputEpoch: 1,
    players: [spawnState("a", 1), spawnState("b", 2)],
    stats,
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
