import { beforeAll, expect, test } from "bun:test";
import {
  DUEL,
  MOVEMENT,
  ROOM,
  SPAWNS,
  Simulation,
  initializePhysics,
  neutralInput,
  spawnState,
  type PlayerState,
} from "@derp/simulation";
import {
  emptyInputTiming,
  parseClient,
  parseServer,
  type CombatEvent,
  type InputFrame,
  type StateMessage,
  type EventBatch,
} from "@derp/protocol";
import { Room } from "../../apps/server/src/room";
import { Controls } from "../../apps/client/src/input";
import { CombatPresentation } from "../../apps/client/src/combat";
import {
  Interpolation,
  confirmedLocalProtectionUntil,
} from "../../apps/client/src/prediction";
import { batchCombatEvents } from "../../apps/server/src/server";

beforeAll(initializePhysics);

test("local shield display uses confirmed state and a shot event before its snapshot", () => {
  const confirmed = {
    ...spawnState("a", 1),
    spawnProtectedUntilTick: 61,
  };
  const predicted = { ...confirmed, spawnProtectedUntilTick: 0 };
  // Prediction may already be past expiry; the confirmed snapshot is not.
  expect(
    confirmedLocalProtectionUntil(predicted, confirmed, 4, undefined),
  ).toBe(61);
  const shot = { lifeId: 1, eventId: 5 };
  // An older prediction can also retain protection after the shot event.
  const stale = { ...confirmed };
  expect(confirmedLocalProtectionUntil(stale, confirmed, 4, shot)).toBe(0);
  expect(
    confirmedLocalProtectionUntil(
      stale,
      { ...confirmed, spawnProtectedUntilTick: 0 },
      5,
      shot,
    ),
  ).toBe(0);
  expect(
    confirmedLocalProtectionUntil({ ...stale, lifeId: 2 }, confirmed, 4, shot),
  ).toBe(0);
});

function duel() {
  const room = new Room();
  const a = room.join("a")!;
  const b = room.join("b")!;
  room.baseline("a");
  room.baseline("b");
  a.state = { ...a.state, x: -1, y: 0.92, spawnProtectedUntilTick: 0 };
  b.state = { ...b.state, x: 1, y: 0.92, spawnProtectedUntilTick: 0 };
  return { room, a, b };
}

function fire(
  room: Room,
  peer: ReturnType<Room["join"]>,
  aimQ: number,
  tick = room.tick + 1,
) {
  if (!peer) throw new Error("Missing peer");
  const input: InputFrame = {
    ...neutralInput(aimQ),
    fire: true,
    type: "input",
    inputEpoch: peer.epoch,
    lifeId: peer.state.lifeId,
    tick,
  };
  room.input(peer.state.id, input);
  return input;
}

test("four confirmed hits kill exactly once and respawn at D+120", () => {
  const { room, a, b } = duel();
  try {
    const health: number[] = [];
    let deathTick = 0;
    let deathCount = 0;
    let oldEpoch = b.epoch;
    for (let n = 0; n < 60 && !deathTick; n++) {
      if (n < 32) fire(room, a, 0);
      for (const event of room.step()) {
        if (event.type === "impact" && event.target === "player")
          health.push(event.health);
        if (event.type === "death") {
          deathTick = room.tick;
          deathCount++;
          expect(event.player.health).toBe(0);
          expect(event.player.respawnAtTick).toBe(
            deathTick + DUEL.respawnTicks,
          );
        }
      }
    }
    expect(health).toEqual([75, 50, 25, 0]);
    expect(deathCount).toBe(1);
    expect(room.deaths).toBe(1);
    expect(b.state.health).toBe(0);
    expect(b.epoch).not.toBe(oldEpoch);
    oldEpoch = b.epoch;
    const dead = { ...b.state };
    const sim = new Simulation();
    const result = sim.stepWithActions(
      dead,
      {
        ...neutralInput(1234),
        moveX: 1,
        jumpPressed: true,
        jetHeld: true,
        fire: true,
      },
      { jetsEnabled: true },
    );
    expect(result).toEqual({ state: dead, shotAuthorized: false });
    sim.dispose();
    fire(room, b, -32768);
    expect(b.inputs.size).toBe(0);
    while (room.tick < deathTick + DUEL.respawnTicks - 1) {
      expect(
        room.step().filter((event) => event.type === "respawn"),
      ).toHaveLength(0);
      expect(b.state).toEqual(dead);
    }
    const events = room.step();
    expect(room.tick).toBe(deathTick + 120);
    expect(events.filter((event) => event.type === "respawn")).toHaveLength(1);
    expect(b.state).toMatchObject({
      health: 100,
      lifeId: 2,
      respawnAtTick: null,
      x: 8,
      jetFuelTicksRemaining: 45,
      carbineCooldownTicksRemaining: 0,
    });
    expect(b.state.spawnProtectedUntilTick).toBe(room.tick + 60);
    expect(b.epoch).not.toBe(oldEpoch);
    expect(room.roomGeneration).toBe(1);
    room.input("b", {
      ...neutralInput(0),
      type: "input",
      inputEpoch: oldEpoch,
      lifeId: 1,
      tick: room.tick + 1,
    });
    room.input("b", {
      ...neutralInput(0),
      type: "input",
      inputEpoch: b.epoch,
      lifeId: 1,
      tick: room.tick + 1,
    });
    expect(b.inputs.size).toBe(0);
  } finally {
    room.dispose();
  }
});

test("protection absorbs a projectile; authorized firing cancels it", () => {
  const { room, a, b } = duel();
  try {
    b.state.spawnProtectedUntilTick = 60;
    fire(room, a, 0);
    let absorbed: CombatEvent | undefined;
    for (let i = 0; i < 8; i++) {
      absorbed = room
        .step()
        .find((event) => event.type === "impact" && event.target === "player");
      if (absorbed) break;
    }
    expect(absorbed).toMatchObject({
      type: "impact",
      target: "player",
      damage: 0,
      health: 100,
    });
    expect(room.protectedHits).toBe(1);
    expect(b.state.health).toBe(100);
    b.state.spawnProtectedUntilTick = room.tick + 60;
    fire(room, b, -32768, room.tick + 1);
    room.step();
    expect(b.state.spawnProtectedUntilTick).toBe(0);
    while (room.tick < 11) room.step();
    fire(room, a, 0);
    let damaged: CombatEvent | undefined;
    for (let i = 0; i < 8; i++) {
      damaged = room
        .step()
        .find(
          (event) =>
            event.type === "impact" &&
            event.target === "player" &&
            event.targetId === "b",
        );
      if (damaged) break;
    }
    expect(damaged).toMatchObject({ damage: 25, health: 75 });
  } finally {
    room.dispose();
  }
});

test("the protection expiry tick is exclusive", () => {
  for (const [until, expected] of [
    [3, 25],
    [4, 0],
  ] as const) {
    const { room, a, b } = duel();
    try {
      b.state.spawnProtectedUntilTick = until;
      fire(room, a, 0);
      let hit: CombatEvent | undefined;
      for (let i = 0; i < 5; i++) {
        hit = room
          .step()
          .find(
            (event) => event.type === "impact" && event.target === "player",
          );
        if (hit) break;
      }
      expect(room.tick).toBe(3);
      expect(hit).toMatchObject({ damage: expected, health: 100 - expected });
      if (until === 3) expect(b.state.spawnProtectedUntilTick).toBe(0);
    } finally {
      room.dispose();
    }
  }
});

test("respawn chooses the farther spawn, with own-slot ties and no-opponent fallback", () => {
  for (const [opponentX, expectedX] of [
    [-7, 8],
    [7, -8],
    [0, 8],
  ] as const) {
    const { room, a, b } = duel();
    try {
      a.state.x = opponentX;
      b.state = {
        ...b.state,
        health: 0,
        respawnAtTick: 1,
        spawnProtectedUntilTick: 0,
      };
      room.step();
      expect(b.state.x).toBe(expectedX);
    } finally {
      room.dispose();
    }
  }
  const { room, a, b } = duel();
  try {
    room.leave("a");
    b.state = {
      ...b.state,
      health: 0,
      respawnAtTick: 1,
      spawnProtectedUntilTick: 0,
    };
    room.step();
    expect(b.state.x).toBe(8);
    expect(a.state.id).toBe("a");
  } finally {
    room.dispose();
  }
});

test("a suspended player remains vulnerable and is not reactivated by life transitions", () => {
  const { room, a, b } = duel();
  try {
    b.state.health = 25;
    room.suspend("b");
    fire(room, a, 0);
    while (room.deaths === 0) room.step();
    expect(b.active).toBe(false);
    const deadline = b.state.respawnAtTick!;
    while (room.tick < deadline) room.step();
    expect(b.state.health).toBe(100);
    expect(b.active).toBe(false);
    expect(b.inputs.size).toBe(0);
  } finally {
    room.dispose();
  }
});

test("a lethal-tick shot survives death and retains its owner's life after disconnect", () => {
  const { room, a, b } = duel();
  try {
    a.state.health = 25;
    b.state.health = 25;
    fire(room, a, 0);
    room.step();
    room.step();
    fire(room, b, -32768);
    const lethal = room.step();
    expect(lethal).toContainEqual(
      expect.objectContaining({
        type: "death",
        player: expect.objectContaining({ id: "b" }),
      }),
    );
    expect(lethal).toContainEqual(
      expect.objectContaining({ type: "shot", ownerId: "b", ownerLifeId: 1 }),
    );
    room.leave("b");
    const replacement = room.join("c")!;
    expect(replacement.state.slot).toBe(2);
    let attributed: CombatEvent | undefined;
    for (let i = 0; i < 8; i++) {
      attributed = room
        .step()
        .find(
          (event) =>
            event.type === "impact" &&
            event.target === "player" &&
            event.targetId === "a",
        );
      if (attributed) break;
    }
    expect(attributed).toMatchObject({
      type: "impact",
      ownerId: "b",
      ownerLifeId: 1,
      targetId: "a",
      damage: 25,
      health: 0,
    });
  } finally {
    room.dispose();
  }
});

test("mutual shots permit simultaneous deaths with stable owner lives", () => {
  const { room, a, b } = duel();
  try {
    a.state.health = 25;
    b.state.health = 25;
    fire(room, a, 0);
    fire(room, b, -32768);
    const all: CombatEvent[] = [];
    for (let i = 0; i < 8 && room.deaths < 2; i++) all.push(...room.step());
    const deaths = all.filter((event) => event.type === "death");
    expect(deaths).toHaveLength(2);
    expect(
      new Set(
        deaths.map((event) => (event.type === "death" ? event.player.id : "")),
      ),
    ).toEqual(new Set(["a", "b"]));
    expect(all.map((event) => event.eventId)).toEqual(
      all.map((_, index) => index + 1),
    );
    expect(a.state.health).toBe(0);
    expect(b.state.health).toBe(0);
  } finally {
    room.dispose();
  }
});

test("spawn candidates clear terrain and simultaneous respawns use distinct slots", () => {
  for (const spawn of SPAWNS)
    for (const solid of ROOM.solids)
      expect(
        Math.abs(spawn.x - solid.x) <
          (MOVEMENT.width + solid.width) / 2 + MOVEMENT.margin &&
          Math.abs(spawn.y - solid.y) <
            (MOVEMENT.height + solid.height) / 2 + MOVEMENT.margin,
      ).toBe(false);
  const { room, a, b } = duel();
  try {
    for (const peer of [a, b])
      peer.state = {
        ...peer.state,
        health: 0,
        respawnAtTick: 1,
        spawnProtectedUntilTick: 0,
        jetActive: false,
      };
    const events = room.step();
    expect(events.map((event) => event.type)).toEqual(["respawn", "respawn"]);
    expect(a.state.x).toBe(-8);
    expect(b.state.x).toBe(8);
    expect(a.state.lifeId).toBe(2);
    expect(b.state.lifeId).toBe(2);
  } finally {
    room.dispose();
  }
});

test("physical fire held through death needs release and a fresh press", () => {
  const controls = new Controls();
  controls.pressFire();
  expect(controls.sample().fire).toBe(true);
  controls.clear();
  controls.pressFire(false);
  expect(controls.sample().fire).toBe(false);
  controls.pressFire();
  expect(controls.sample().fire).toBe(false);
  controls.releaseFire();
  controls.pressFire();
  expect(controls.sample().fire).toBe(true);
  controls.releaseFire();
  controls.pressFire();
  controls.releaseFire();
  expect(controls.sample().fire).toBe(true);
});

test("lifecycle wire contracts reject absent and forged life fields", () => {
  const input: InputFrame = {
    ...neutralInput(0),
    type: "input",
    inputEpoch: 1,
    lifeId: 1,
    tick: 1,
  };
  expect(parseClient(JSON.stringify(input))).toEqual(input);
  const { lifeId: _lifeId, ...missing } = input;
  for (const malformed of [
    missing,
    { ...input, lifeId: 0 },
    { ...input, lifeId: 1.5 },
    { ...input, health: 100 },
  ])
    expect(() => parseClient(JSON.stringify(malformed))).toThrow();
  const { room } = duel();
  try {
    const state = room.snapshot()[0]!;
    const death = {
      type: "death",
      eventId: 1,
      player: {
        ...state,
        health: 0,
        respawnAtTick: 120,
        jetActive: false,
        spawnProtectedUntilTick: 0,
      },
      killerId: "b",
      killerLifeId: 1,
      projectileId: 1,
    };
    expect(
      parseServer(
        JSON.stringify({
          type: "events",
          roomGeneration: 1,
          tick: 1,
          events: [death],
        }),
      ).type,
    ).toBe("events");
    expect(() =>
      parseServer(
        JSON.stringify({
          type: "events",
          roomGeneration: 1,
          tick: 1,
          events: [{ ...death, player: { ...death.player, health: 100 } }],
        }),
      ),
    ).toThrow();
  } finally {
    room.dispose();
  }
});

function view(
  tick: number,
  players: PlayerState[],
  projectiles: StateMessage["projectiles"] = [],
): StateMessage {
  return {
    type: "snapshot",
    tick,
    serverTime: (tick * 1000) / 60,
    playerId: "a",
    inputEpoch: 1,
    roomGeneration: 1,
    eventCursor: 0,
    players,
    projectiles,
    rules: { jetsEnabled: false },
    reason: "test",
    inputTiming: emptyInputTiming(),
    stats: {
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
    },
  };
}

test("remote life transitions switch at their event tick and never blend across lives", () => {
  const room = new Room();
  try {
    const a = room.join("a")!.state;
    const b = {
      ...room.join("b")!.state,
      x: 1,
      health: 25,
      spawnProtectedUntilTick: 0,
    };
    const dead = { ...b, x: 2, health: 0, respawnAtTick: 135, vx: 0, vy: 0 };
    const reborn = {
      ...b,
      x: 8,
      lifeId: 2,
      health: 100,
      spawnProtectedUntilTick: 200,
    };
    const remote = new Interpolation();
    remote.push(view(0, [a, b]));
    remote.record(
      {
        type: "death",
        eventId: 1,
        player: dead,
        killerId: "a",
        killerLifeId: 1,
        projectileId: 1,
      },
      15,
    );
    remote.push(view(20, [a, dead]));
    remote.record({ type: "respawn", eventId: 2, player: reborn }, 135);
    remote.push(view(141, [a, { ...reborn, x: 7.9 }]));
    expect(remote.at(14, "a")[0]).toMatchObject({ lifeId: 1, health: 25 });
    expect(remote.at(15, "a")[0]).toMatchObject({ lifeId: 1, health: 0, x: 2 });
    expect(remote.at(134, "a")[0]).toMatchObject({
      lifeId: 1,
      health: 0,
      x: 2,
    });
    expect(remote.at(135, "a")[0]).toMatchObject({
      lifeId: 2,
      health: 100,
      x: 8,
    });
  } finally {
    room.dispose();
  }
});

test("shot and impact presentation obey historical ticks and event batches stay ordered", () => {
  const { room, a, b } = duel();
  try {
    const combat = new CombatPresentation();
    combat.baseline(view(0, [a.state, b.state]));
    const shot: CombatEvent = {
      type: "shot",
      eventId: 1,
      projectileId: 1,
      ownerId: "a",
      ownerLifeId: 1,
      ownerSlot: 1,
      sourceInputEpoch: 1,
      sourceTick: 10,
      x: -0.5,
      y: 0.92,
      aimQ: 0,
    };
    const impact: CombatEvent = {
      type: "impact",
      eventId: 2,
      projectileId: 1,
      target: "player",
      targetId: "b",
      targetLifeId: 1,
      ownerId: "a",
      ownerLifeId: 1,
      damage: 25,
      health: 75,
      x: 0.6,
      y: 0.92,
      normalX: -1,
      normalY: 0,
    };
    const first: EventBatch = {
      type: "events",
      roomGeneration: 1,
      tick: 10,
      events: [shot],
    };
    const second: EventBatch = {
      type: "events",
      roomGeneration: 1,
      tick: 12,
      events: [impact],
    };
    expect(combat.receive(first, "b")).toBe(true);
    expect(combat.receive(second, "b")).toBe(true);
    expect(combat.presentation([], 9).projectiles).toHaveLength(0);
    expect(combat.presentation([], 10).projectiles).toHaveLength(1);
    expect(combat.presentation([], 11).projectiles).toHaveLength(1);
    expect(combat.presentation([], 12).projectiles).toHaveLength(0);
    expect(combat.presentation([], 11).effects).toHaveLength(1);
    expect(combat.presentation([], 12).effects).toHaveLength(2);
    expect(combat.receive(second, "b")).toBe(true);
    expect(combat.diagnostics().duplicateEvents).toBe(1);
    const twenty = Array.from({ length: 20 }, (_, index): CombatEvent => ({
      type: "impact",
      eventId: index + 1,
      projectileId: index + 1,
      target: "terrain",
      x: 0,
      y: 0,
      normalX: -1,
      normalY: 0,
    }));
    const batches = batchCombatEvents(twenty, 1, 42);
    expect(batches.map((batch) => batch.events.length)).toEqual([16, 4]);
    expect(
      batches.flatMap((batch) => batch.events.map((event) => event.eventId)),
    ).toEqual(twenty.map((event) => event.eventId));
    for (const batch of batches)
      expect(parseServer(JSON.stringify(batch))).toEqual(batch);
  } finally {
    room.dispose();
  }
});
