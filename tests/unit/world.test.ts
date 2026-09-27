import { beforeAll, expect, test } from "bun:test";
import {
  initializePhysics,
  MOVEMENT,
  NEUTRAL,
  ROOM,
  SPAWNS,
  Simulation,
  spawnState,
} from "@derp/simulation";

beforeAll(initializePhysics);
const rules = { jetsEnabled: false };
const CLIMB_X = [14, 19, 24, 29, 34, 29, 24, 19, 14, 19, 24, 29];
const STAND = 0.9101;

function climb(sign: 1 | -1) {
  return CLIMB_X.map((x, index) => ({
    x: sign * x,
    y: 1.25 + 2 * index,
    width: 3,
    height: 0.5,
  }));
}

test("central platforms and spawns stay, and both climbs use the specified centers", () => {
  expect(ROOM.width).toBe(72);
  expect(ROOM.height).toBe(27);
  expect(SPAWNS).toEqual([
    { x: -8, y: 0.92, slot: 1 },
    { x: 8, y: 0.92, slot: 2 },
  ]);
  for (const solid of [
    { x: -4, y: 1.25, width: 4, height: 0.5 },
    { x: 3, y: 2.75, width: 4, height: 0.5 },
    { x: -8, y: 4, width: 3, height: 0.5 },
  ])
    expect(ROOM.solids).toContainEqual(solid);
  for (const sign of [1, -1] as const)
    for (const platform of climb(sign))
      expect(ROOM.solids).toContainEqual(platform);
});

test("movement passes the old walls and ceiling, then stops on the new ones", () => {
  const sim = new Simulation();
  let state = { ...spawnState("traveler", 1), x: 0, y: 14, vy: 0 };
  for (let tick = 0; tick < 30 && state.y >= 13; tick++)
    state = sim.step(state, NEUTRAL, rules);
  expect(state.y).toBeLessThan(13);
  expect(state.vy).toBeLessThan(0);
  state = { ...spawnState("traveler", 1), x: 11, y: 4, vy: 0, grounded: false };
  for (let tick = 0; tick < 30; tick++)
    state = sim.step(state, { ...NEUTRAL, moveX: 1 }, rules);
  expect(state.x).toBeGreaterThan(12);
  expect(state.vx).toBeGreaterThan(0);
  state = { ...state, x: 35, y: STAND, vy: 0, grounded: true };
  for (let tick = 0; tick < 60; tick++)
    state = sim.step(state, { ...NEUTRAL, moveX: 1 }, rules);
  expect(state.x).toBeGreaterThan(35.58);
  expect(state.x).toBeLessThan(35.601);
  expect(state.vx).toBe(0);
  state = {
    ...spawnState("traveler", 1),
    x: 0,
    y: 25.58,
    vy: 12,
    grounded: false,
  };
  state = sim.step(state, NEUTRAL, rules);
  expect(state.vy).toBe(0);
  expect(state.y).toBeGreaterThan(25.58);
  expect(state.y).toBeLessThan(25.591);
  sim.dispose();
});

test("all 24 climb transfers land without jets", () => {
  const sim = new Simulation();
  const landed = (
    state: { x: number; y: number; grounded: boolean },
    platform: { x: number; y: number; width: number; height: number },
  ) =>
    state.grounded &&
    Math.abs(state.x - platform.x) <= platform.width / 2 - MOVEMENT.width / 2 &&
    Math.abs(state.y - (platform.y + platform.height / 2 + STAND)) < 0.02;

  for (const sign of [1, -1] as const) {
    const platforms = climb(sign);
    let state = {
      ...spawnState("climber", 1),
      x: sign * 8,
      y: STAND,
      vy: 0,
      grounded: true,
    };
    for (let tick = 0; tick < 180 && !landed(state, platforms[0]!); tick++)
      state = sim.step(
        state,
        { ...NEUTRAL, moveX: sign, jumpPressed: tick === 0 },
        rules,
      );
    expect(landed(state, platforms[0]!), `approach ${sign}`).toBe(true);
    for (let settle = 0; settle < 30; settle++)
      state = sim.step(state, NEUTRAL, rules);
    for (let index = 1; index < platforms.length; index++) {
      const next = platforms[index]!;
      const dir = Math.sign(next.x - state.x) as -1 | 1;
      let jumped = false;
      let reached = false;
      for (let tick = 0; tick < 200; tick++) {
        const jumpPressed =
          !jumped && state.grounded && Math.abs(next.x - state.x) <= 3.8;
        if (jumpPressed) jumped = true;
        state = sim.step(state, { ...NEUTRAL, moveX: dir, jumpPressed }, rules);
        if (landed(state, next)) {
          reached = true;
          break;
        }
      }
      expect(reached, `route ${sign} platform ${index}`).toBe(true);
      for (let settle = 0; settle < 20; settle++)
        state = sim.step(state, NEUTRAL, rules);
    }
  }
  sim.dispose();
});
