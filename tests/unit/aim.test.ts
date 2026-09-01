import { beforeAll, expect, test } from "bun:test";
import {
  AIM_MAX,
  AIM_MIN,
  AIM_QUARTER_TURN,
  Simulation,
  aimQFromVector,
  aimQToDegrees,
  initializePhysics,
  interpolateAimQ,
  neutralInput,
  shortestAimDelta,
  spawnState,
  wrapAimQ,
} from "@derp/simulation";
import { emptyInputTiming, type StateMessage } from "@derp/protocol";
import { PointerAim, pointerToWorld } from "../../apps/client/src/input";
import { Interpolation, Prediction } from "../../apps/client/src/prediction";
import { Room } from "../../apps/server/src/room";

beforeAll(initializePhysics);

const stats = {
  tickP95: 0,
  tickP99: 0,
  scheduleMs: 0,
  overruns: 0,
  lateInputs: 0,
  connections: 2,
  queuedInputs: 0,
  rssMB: 0,
  inBytes: 0,
  outBytes: 0,
};

test("signed aim math covers cardinals, wrapping and deterministic antipodes", () => {
  expect(aimQFromVector(1, 0)).toBe(0);
  expect(aimQFromVector(0, 1)).toBe(AIM_QUARTER_TURN);
  expect(aimQFromVector(-1, 0)).toBe(AIM_MIN);
  expect(aimQFromVector(0, -1)).toBe(-AIM_QUARTER_TURN);
  expect(aimQFromVector(1, 1)).toBe(AIM_QUARTER_TURN / 2);
  expect(wrapAimQ(AIM_MAX + 1)).toBe(AIM_MIN);
  expect(wrapAimQ(AIM_MIN - 1)).toBe(AIM_MAX);
  expect(shortestAimDelta(0, AIM_MIN)).toBe(AIM_MIN);
  expect(interpolateAimQ(0, AIM_MIN, 0.5)).toBe(-AIM_QUARTER_TURN);
  const positive179 = wrapAimQ((179 / 360) * 65_536);
  const negative179 = wrapAimQ((-179 / 360) * 65_536);
  expect(Math.abs(shortestAimDelta(positive179, negative179))).toBeLessThan(
    400,
  );
  expect(Math.abs(Math.abs(aimQToDegrees(positive179)) - 179)).toBeLessThan(
    0.01,
  );
});

test("canvas coordinates map to fixed world corners without DPR input", () => {
  const rect = { left: 100, top: 50, width: 800, height: 450 };
  expect(pointerToWorld(100, 50, rect)).toEqual({ x: -12, y: 13.5 });
  expect(pointerToWorld(900, 500, rect)).toEqual({ x: 12, y: 0 });
  expect(pointerToWorld(500, 275, rect)).toEqual({ x: 0, y: 6.75 });
  expect(pointerToWorld(99, 50, rect)).toBeUndefined();
  expect(pointerToWorld(100, 50, { ...rect, width: 0 })).toBeUndefined();
});

test("dead zone holds the prior aim and aim-only ticks cannot alter movement", () => {
  const pointer = new PointerAim();
  const initial = { ...spawnState("aim", 1), aimQ: 1234 };
  expect(
    pointer.sample(initial, { x: initial.x + 0.05, y: initial.y }),
  ).toEqual({ aimQ: 1234, reticleVisible: false });
  expect(pointer.sample(initial, { x: initial.x, y: initial.y + 1 })).toEqual({
    aimQ: AIM_QUARTER_TURN,
    reticleVisible: true,
  });
  const changing = new Simulation();
  const fixed = new Simulation();
  let aimed = spawnState("same", 1);
  let neutral = spawnState("same", 1);
  for (let tick = 0; tick < 1000; tick++) {
    aimed = changing.step(
      aimed,
      { ...neutralInput(aimed.aimQ), aimQ: wrapAimQ(tick * 977) },
      { jetsEnabled: true },
    );
    neutral = fixed.step(neutral, neutralInput(neutral.aimQ), {
      jetsEnabled: true,
    });
    const { aimQ: _aimed, ...aimedMovement } = aimed;
    const { aimQ: _neutral, ...neutralMovement } = neutral;
    expect(aimedMovement).toEqual(neutralMovement);
  }
  changing.dispose();
  fixed.dispose();
});

test("authority preserves missing aim, accepts one value and reconciliation retires it", () => {
  const room = new Room();
  const prediction = new Prediction();
  const peer = room.join("a")!;
  room.baseline("a");
  const baseline: StateMessage = {
    type: "baseline",
    tick: room.tick,
    serverTime: 0,
    playerId: "a",
    inputEpoch: peer.epoch,
    players: room.snapshot(),
    rules: { jetsEnabled: false },
    stats,
    inputTiming: emptyInputTiming(),
    reason: "aim test",
  };
  prediction.baseline(baseline, room.tick);
  const frame = prediction.advance({ ...neutralInput(0), aimQ: 5000 });
  room.input("a", frame);
  room.input("a", { ...frame, aimQ: -5000 });
  room.step();
  expect(peer.state.aimQ).toBe(5000);
  room.step();
  expect(peer.state.aimQ).toBe(5000);
  prediction.reconcile({
    ...baseline,
    type: "snapshot",
    tick: 1,
    players: [{ ...peer.state, aimQ: 0 }],
  });
  expect(prediction.aimCorrection).toBe(5000);
  expect(prediction.state!.aimQ).toBe(0);
  expect(prediction.history.size).toBe(0);
  prediction.dispose();
  room.dispose();
});

test("remote aim uses the same historical interval and shortest arc as position", () => {
  const interpolation = new Interpolation();
  const local = spawnState("local", 1);
  const remote = { ...spawnState("remote", 2), aimQ: 32_586 };
  const base: StateMessage = {
    type: "snapshot",
    tick: 10,
    serverTime: 0,
    playerId: local.id,
    inputEpoch: 1,
    players: [local, remote],
    rules: { jetsEnabled: false },
    stats,
    inputTiming: emptyInputTiming(),
    reason: "",
  };
  interpolation.push(base);
  interpolation.push({
    ...base,
    tick: 12,
    players: [local, { ...remote, x: 10, aimQ: -32_586 }],
  });
  const middle = interpolation.at(11, local.id)[0]!;
  expect(middle.x).toBe(9);
  expect(Math.abs(middle.aimQ)).toBeGreaterThan(32_500);
  const held = interpolation.at(100, local.id)[0]!;
  expect(held.x).toBe(10);
  expect(held.aimQ).toBe(-32_586);
});
