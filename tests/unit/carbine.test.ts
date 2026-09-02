import { beforeAll, expect, test } from "bun:test";
import {
  AIM_MIN,
  CARBINE,
  MOVEMENT,
  ROOM,
  Simulation,
  initializePhysics,
  neutralInput,
  spawnState,
  sweepSegmentAabb,
} from "@derp/simulation";
import {
  emptyInputTiming,
  parseServer,
  type EventBatch,
  type StateMessage,
} from "@derp/protocol";
import { Room } from "../../apps/server/src/room";
import { Controls } from "../../apps/client/src/input";
import { CombatPresentation } from "../../apps/client/src/combat";
import {
  combatFixtureTrace,
  parseCombatTrace,
  replayCombatTrace,
} from "../../apps/server/src/combat-replay";

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

function message(room: Room, playerId: string, type: "baseline" | "snapshot") {
  const peer = room.participants.get(playerId)!;
  return {
    type,
    tick: room.tick,
    serverTime: 0,
    playerId,
    inputEpoch: peer.epoch,
    roomGeneration: room.roomGeneration,
    eventCursor: room.eventCursor,
    players: room.snapshot(),
    projectiles: room.projectileSnapshot(),
    rules: { ...room.rules },
    stats,
    inputTiming: emptyInputTiming(),
    reason: "test",
  } satisfies StateMessage;
}

test("automatic trigger latches taps and cooldown authorizes ticks S and S+10", () => {
  const controls = new Controls();
  controls.pressFire();
  controls.releaseFire();
  expect(controls.sample().fire).toBe(true);
  expect(controls.sample().fire).toBe(false);
  controls.pressFire();
  expect(controls.sample().fire).toBe(true);
  expect(controls.sample().fire).toBe(true);
  controls.releaseFire();
  expect(controls.sample().fire).toBe(false);
  controls.pressFire();
  controls.clear();
  expect(controls.sample().fire).toBe(false);

  const sim = new Simulation();
  let state = spawnState("cadence", 1);
  const shots: number[] = [];
  for (let tick = 1; tick <= 21; tick++) {
    const result = sim.stepWithActions(
      state,
      { ...neutralInput(state.aimQ), fire: true },
      { jetsEnabled: false },
    );
    state = result.state;
    if (result.shotAuthorized) shots.push(tick);
  }
  expect(shots).toEqual([1, 11, 21]);
  expect(state.carbineCooldownTicksRemaining).toBe(CARBINE.cooldownTicks);
  sim.dispose();
});

test("fire-only input changes cooldown but no movement, collision, jump, jet, or aim state", () => {
  const firing = new Simulation();
  const neutral = new Simulation();
  let a = spawnState("same", 1);
  let b = { ...a };
  for (let tick = 0; tick < 1_000; tick++) {
    const aimQ = tick % 2 ? AIM_MIN : 0;
    a = firing.step(
      a,
      { ...neutralInput(aimQ), fire: true },
      { jetsEnabled: true },
    );
    b = neutral.step(b, neutralInput(aimQ), { jetsEnabled: true });
    const { carbineCooldownTicksRemaining: _aCooldown, ...aMovement } = a;
    const { carbineCooldownTicksRemaining: _bCooldown, ...bMovement } = b;
    expect(aMovement).toEqual(bMovement);
  }
  firing.dispose();
  neutral.dispose();
});

test("segment sweep includes tangents, corners and inside starts with stable normals", () => {
  const box = { x: 0, y: 0, width: 2, height: 2 };
  expect(sweepSegmentAabb({ x: -2, y: 1 }, { x: 2, y: 1 }, box)).toMatchObject({
    toi: 0.25,
    normalX: -1,
    normalY: 0,
  });
  expect(sweepSegmentAabb({ x: -2, y: -2 }, { x: 0, y: 0 }, box)).toMatchObject(
    { toi: 0.5, x: -1, y: -1 },
  );
  expect(sweepSegmentAabb({ x: 0, y: 0 }, { x: 2, y: 0 }, box)).toMatchObject({
    toi: 0,
    normalX: -1,
    normalY: 0,
  });
  expect(
    sweepSegmentAabb({ x: -2, y: 1.1 }, { x: 2, y: 1.1 }, box),
  ).toBeUndefined();
});

test("room emits ordered shot and moving-player impact events without physical damage", () => {
  const room = new Room();
  const shooter = room.join("shooter")!;
  const target = room.join("target")!;
  room.baseline("shooter");
  room.baseline("target");
  shooter.state = {
    ...shooter.state,
    x: -2,
    y: 5,
    aimQ: 0,
    grounded: false,
  };
  target.state = {
    ...target.state,
    x: 2,
    y: 5,
    aimQ: AIM_MIN,
    grounded: false,
  };
  const targetBefore = { ...target.state };
  const frame = {
    ...neutralInput(0),
    fire: true,
    type: "input" as const,
    inputEpoch: shooter.epoch,
    tick: room.tick + 1,
  };
  room.input("shooter", frame);
  room.input("shooter", frame);
  let events = room.step();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "shot",
    eventId: 1,
    projectileId: 1,
    ownerId: "shooter",
    sourceTick: 1,
  });
  expect(room.projectileSnapshot()).toHaveLength(1);
  for (
    let i = 0;
    i < 10 && !events.some((event) => event.type === "impact");
    i++
  )
    events = room.step();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "impact",
    eventId: 2,
    projectileId: 1,
    target: "player",
    targetId: "target",
  });
  expect(target.state.x).toBeCloseTo(targetBefore.x, 6);
  expect(target.state.vx).toBe(targetBefore.vx);
  expect(room.projectileSnapshot()).toHaveLength(0);
  room.dispose();
});

test("terrain wins equal-time ties, lifetime expires silently, and reset isolates generations", () => {
  const room = new Room();
  const peer = room.join("a")!;
  room.baseline("a");
  peer.state = {
    ...peer.state,
    x: 11.55,
    y: 5,
    aimQ: 0,
  };
  room.input("a", {
    ...neutralInput(0),
    fire: true,
    type: "input",
    inputEpoch: peer.epoch,
    tick: 1,
  });
  const blocked = room.step();
  expect(blocked.map((event) => event.type)).toEqual(["shot", "impact"]);
  expect(blocked[1]).toMatchObject({ target: "terrain" });
  const generation = room.roomGeneration;
  room.reset();
  expect(room.roomGeneration).toBe(generation + 1);
  expect(room.eventCursor).toBe(0);
  expect(room.projectileSnapshot()).toEqual([]);
  expect(room.snapshot()[0]!.carbineCooldownTicksRemaining).toBe(0);

  peer.state = { ...peer.state, x: 100, y: 100, aimQ: 0 };
  room.baseline("a");
  room.input("a", {
    ...neutralInput(0),
    fire: true,
    type: "input",
    inputEpoch: peer.epoch,
    tick: room.tick + 1,
  });
  room.step();
  let impactEvents = 0;
  for (let i = 0; i < CARBINE.lifetimeTicks; i++)
    impactEvents += room
      .step()
      .filter((event) => event.type === "impact").length;
  expect(impactEvents).toBe(0);
  expect(room.expiredProjectiles).toBeGreaterThan(0);
  room.dispose();
});

test("event cursor matches provisionals once and fails closed on gaps", () => {
  const room = new Room();
  const peer = room.join("local")!;
  room.baseline("local");
  const baseline = message(room, "local", "baseline");
  const combat = new CombatPresentation();
  combat.baseline(baseline);
  combat.predictedShot(peer.state, peer.epoch, 1);
  const batch: EventBatch = {
    type: "events",
    roomGeneration: room.roomGeneration,
    tick: 1,
    events: [
      {
        type: "shot",
        eventId: 1,
        projectileId: 1,
        ownerId: "local",
        ownerSlot: 1,
        sourceInputEpoch: peer.epoch,
        sourceTick: 1,
        x: -7.5,
        y: 1,
        aimQ: 0,
      },
    ],
  };
  expect(parseServer(JSON.stringify(batch))).toEqual(batch);
  expect(combat.receive(batch, "local")).toBe(true);
  expect(combat.diagnostics()).toMatchObject({
    eventCursor: 1,
    confirmations: 1,
    provisionals: 0,
  });
  expect(combat.receive(batch, "local")).toBe(true);
  expect(combat.diagnostics().duplicateEvents).toBe(1);
  expect(
    combat.receive(
      {
        ...batch,
        events: [{ ...batch.events[0]!, eventId: 3, projectileId: 2 }],
      },
      "local",
    ),
  ).toBe(false);
  expect(combat.diagnostics().eventGaps).toBe(1);
  room.dispose();
});

test("muzzle geometry remains outside the player and static room collision is expanded", () => {
  const halfWidth = MOVEMENT.width / 2 + CARBINE.halfExtent;
  const state = { ...spawnState("muzzle", 1), x: 0, y: 5, aimQ: 0 };
  const sim = new Simulation();
  const fired = sim.stepWithActions(
    state,
    { ...neutralInput(0), fire: true },
    { jetsEnabled: false },
  );
  expect(fired.shotAuthorized).toBe(true);
  const rightWall = ROOM.solids[3]!;
  expect(
    sweepSegmentAabb(
      { x: rightWall.x - 2, y: rightWall.y },
      { x: rightWall.x + 2, y: rightWall.y },
      rightWall,
      CARBINE.halfExtent,
    )!.x,
  ).toBeCloseTo(rightWall.x - rightWall.width / 2 - CARBINE.halfExtent, 8);
  expect(halfWidth).toBeCloseTo(0.48, 8);
  sim.dispose();
});

test("projectile-lab room trace validates strictly and replays exactly", () => {
  const trace = combatFixtureTrace();
  expect(parseCombatTrace(trace)).toEqual(trace);
  const first = replayCombatTrace(trace);
  const second = replayCombatTrace(trace);
  expect(second).toEqual(first);
  expect(first).toHaveLength(180);
  expect(
    first
      .flatMap((frame) => frame.events)
      .some((event) => event.type === "shot"),
  ).toBe(true);
  for (const invalid of [
    { ...trace, version: "old" },
    { ...trace, contentVersion: "playground-4" },
    {
      ...trace,
      inputs: [[{ ...trace.inputs[0]![0], fire: 1 }, trace.inputs[0]![1]]],
    },
    {
      ...trace,
      inputs: [[{ ...trace.inputs[0]![0], extra: true }, trace.inputs[0]![1]]],
    },
  ])
    expect(() => parseCombatTrace(invalid)).toThrow("combat trace");
});
