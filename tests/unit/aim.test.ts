import { beforeAll, expect, test } from "bun:test";
import {
  AIM_MAX,
  AIM_MIN,
  AIM_QUARTER_TURN,
  DISABLED_RULES,
  DT,
  MOVEMENT,
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
import { cameraBounds, type CameraBounds } from "../../apps/client/src/camera";
import {
  PointerAim,
  pointerToWorld,
  samplePredictedAim,
  type WorldPoint,
} from "../../apps/client/src/input";
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
  projectiles: 0,
  shots: 0,
  terrainImpacts: 0,
  playerImpacts: 0,
  expiredProjectiles: 0,
  capacityDrops: 0,
  damage: 0,
  deaths: 0,
  respawns: 0,
  protectedHits: 0,
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

test("canvas coordinates map through the central view without DPR input", () => {
  const rect = { left: 100, top: 50, width: 800, height: 450 };
  const bounds = cameraBounds();
  expect(pointerToWorld(100, 50, rect, bounds)).toEqual({ x: -12, y: 13.5 });
  expect(pointerToWorld(900, 500, rect, bounds)).toEqual({ x: 12, y: 0 });
  expect(pointerToWorld(500, 275, rect, bounds)).toEqual({ x: 0, y: 6.75 });
  expect(pointerToWorld(99, 50, rect, bounds)).toBeUndefined();
  expect(
    pointerToWorld(100, 50, { ...rect, width: 0 }, bounds),
  ).toBeUndefined();
});

test("five predicted ticks in one frame keep a stationary cursor on the player's left", () => {
  const rect = { left: 10, top: 20, width: 960, height: 540 };
  const canvas = {
    getBoundingClientRect: () => rect,
  } as HTMLCanvasElement;
  const pointer = new PointerAim();
  const simulation = new Simulation();
  let state = spawnState("catch-up", 1);
  let settled = false;
  for (let tick = 0; tick < 180; tick++) {
    const next = simulation.step(
      state,
      neutralInput(state.aimQ),
      DISABLED_RULES,
    );
    settled = next.grounded && Math.abs(next.y - state.y) < 1e-5;
    state = next;
    if (settled) break;
  }
  expect(settled).toBe(true);
  expect(state.x).toBeCloseTo(-8, 4);
  state = { ...state, carbineCooldownTicksRemaining: 5 };
  const cursor = clientPoint(rect, cameraBounds(state), {
    x: state.x - 0.2,
    y: state.y,
  });
  pointer.update(cursor.clientX, cursor.clientY);
  let authorized: number | undefined;
  for (let tick = 0; tick < 5; tick++) {
    const aim = samplePredictedAim(pointer, canvas, state, state);
    const expected = pointerToWorld(
      cursor.clientX,
      cursor.clientY,
      rect,
      cameraBounds(state),
    )!;
    expect(aim.target).toEqual(expected);
    expect(expected.x).toBeCloseTo(state.x - 0.2, 5);
    expect(aim.aimQ).toBe(
      aimQFromVector(expected.x - state.x, expected.y - state.y),
    );
    expect(aim.aimQ).toBe(AIM_MIN);
    const result = simulation.stepWithActions(
      state,
      { ...neutralInput(aim.aimQ), moveX: -1, fire: true },
      DISABLED_RULES,
    );
    if (result.shotAuthorized) authorized = result.state.aimQ;
    state = result.state;
  }
  simulation.dispose();
  expect(state.x).toBeCloseTo(-8 - MOVEMENT.speed * DT * 5, 4);
  expect(state.x).toBeCloseTo(-8.6667, 3);
  expect(authorized).toBe(AIM_MIN);
  const shown = samplePredictedAim(pointer, canvas, state, state);
  expect(shown.target!.x).toBeCloseTo(-8.8667, 3);
  expect(shown.aimQ).toBe(AIM_MIN);
});

function clientPoint(
  rect: { left: number; top: number; width: number; height: number },
  bounds: CameraBounds,
  world: WorldPoint,
) {
  const u = (world.x - bounds.left) / (bounds.right - bounds.left);
  const v = (bounds.top - world.y) / (bounds.top - bounds.bottom);
  return {
    clientX: rect.left + u * rect.width,
    clientY: rect.top + v * rect.height,
  };
}

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
    roomGeneration: 1,
    eventCursor: 0,
    projectiles: [],
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
    roomGeneration: 1,
    eventCursor: 0,
    projectiles: [],
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
