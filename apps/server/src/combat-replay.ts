import {
  CONTENT_VERSION,
  neutralInput,
  spawnState,
  type Input,
  type RoomRules,
  type PlayerState,
} from "@derp/simulation";
import { Room } from "./room";
import {
  validPlayer,
  type CombatEvent,
  type ProjectileView,
} from "@derp/protocol";

export const COMBAT_TRACE_VERSION = "duel-lab-1";

export type CombatTrace = {
  version: typeof COMBAT_TRACE_VERSION;
  contentVersion: typeof CONTENT_VERSION;
  rules: RoomRules;
  initial: [PlayerState, PlayerState];
  inputs: Array<[Input, Input]>;
};

export type CombatReplayFrame = {
  tick: number;
  players: ReturnType<Room["snapshot"]>;
  projectiles: ProjectileView[];
  events: CombatEvent[];
};

export function combatFixtureTrace(): CombatTrace {
  return {
    version: COMBAT_TRACE_VERSION,
    contentVersion: CONTENT_VERSION,
    rules: { jetsEnabled: true },
    initial: [
      { ...spawnState("trace-p1", 1), x: -1, y: 0.92 },
      { ...spawnState("trace-p2", 2), x: 1, y: 0.92 },
    ],
    inputs: Array.from({ length: 440 }, (_, tick) => {
      return [
        {
          ...neutralInput(0),
          fire: tick >= 65 && tick < 280,
        },
        {
          ...neutralInput(-32768),
          fire: tick >= 65 && tick < 280,
        },
      ];
    }),
  };
}

function validInput(value: unknown): value is Input {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).length === 5 &&
    ["moveX", "jumpPressed", "jetHeld", "aimQ", "fire"].every((key) =>
      Object.hasOwn(input, key),
    ) &&
    [-1, 0, 1].includes(input.moveX as number) &&
    typeof input.jumpPressed === "boolean" &&
    typeof input.jetHeld === "boolean" &&
    Number.isInteger(input.aimQ) &&
    (input.aimQ as number) >= -32_768 &&
    (input.aimQ as number) <= 32_767 &&
    typeof input.fire === "boolean"
  );
}

export function parseCombatTrace(value: unknown): CombatTrace {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid combat trace");
  const trace = value as Record<string, unknown>;
  if (
    Object.keys(trace).length !== 5 ||
    trace.version !== COMBAT_TRACE_VERSION ||
    trace.contentVersion !== CONTENT_VERSION ||
    typeof trace.rules !== "object" ||
    trace.rules === null ||
    Array.isArray(trace.rules) ||
    Object.keys(trace.rules).length !== 1 ||
    typeof (trace.rules as Record<string, unknown>).jetsEnabled !== "boolean" ||
    !Array.isArray(trace.initial) ||
    trace.initial.length !== 2 ||
    !trace.initial.every(validPlayer) ||
    trace.initial[0]!.slot !== 1 ||
    trace.initial[1]!.slot !== 2 ||
    trace.initial[0]!.id !== "trace-p1" ||
    trace.initial[1]!.id !== "trace-p2" ||
    !Array.isArray(trace.inputs) ||
    trace.inputs.length > 10_000 ||
    !trace.inputs.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every((input) => validInput(input)),
    )
  )
    throw new Error("Invalid or incompatible combat trace");
  return value as CombatTrace;
}

export function replayCombatTrace(trace: CombatTrace): CombatReplayFrame[] {
  const room = new Room();
  room.rules = { ...trace.rules };
  const first = room.join("trace-p1")!;
  const second = room.join("trace-p2")!;
  first.state = { ...trace.initial[0] };
  second.state = { ...trace.initial[1] };
  room.baseline(first.state.id);
  room.baseline(second.state.id);
  const frames: CombatReplayFrame[] = [];
  try {
    for (const pair of trace.inputs) {
      for (const [index, peer] of [first, second].entries())
        room.input(peer.state.id, {
          type: "input",
          inputEpoch: peer.epoch,
          lifeId: peer.state.lifeId,
          tick: room.tick + 1,
          ...pair[index]!,
        });
      const events = room.step();
      frames.push({
        tick: room.tick,
        players: room.snapshot(),
        projectiles: room.projectileSnapshot(),
        events,
      });
    }
  } finally {
    room.dispose();
  }
  return frames;
}
