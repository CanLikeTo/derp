import {
  CONTENT_VERSION,
  MOVEMENT,
  JETS,
  AIM_MIN,
  AIM_MAX,
  CARBINE,
  type RoomRules,
  TRACE_VERSION,
  type Trace,
  type PlayerState,
} from "@derp/simulation";
export { CONTENT_VERSION };
export const PROTOCOL_VERSION = 6;
export const BUILD_ID = "playground-carbine-lab-v1";
export const LIMITS = {
  messageBytes: 2048,
  futureTicks: 16,
  history: 120,
  snapshots: 40,
  bufferedBytes: 65536,
  rate: 120,
  burst: 120,
  serverMessageBytes: 16_384,
  eventBatch: 16,
} as const;
export type InputFrame = {
  type: "input";
  inputEpoch: number;
  tick: number;
  moveX: -1 | 0 | 1;
  jumpPressed: boolean;
  jetHeld: boolean;
  aimQ: number;
  fire: boolean;
};
export type ClientMessage =
  | { type: "setJets"; inputEpoch: number; enabled: boolean }
  | InputFrame
  | { type: "hello"; protocol: number; content: string }
  | { type: "ping"; nonce: number }
  | { type: "suspend" | "resync" | "reset"; inputEpoch: number };
export type ServerStats = {
  tickP95: number;
  tickP99: number;
  scheduleMs: number;
  overruns: number;
  lateInputs: number;
  connections: number;
  queuedInputs: number;
  rssMB: number;
  inBytes: number;
  outBytes: number;
  projectiles: number;
  shots: number;
  terrainImpacts: number;
  playerImpacts: number;
  expiredProjectiles: number;
  capacityDrops: number;
};
export type InputReceipt = {
  inputEpoch: number;
  tick: number;
  receivedTick: number;
  receivedAt: number;
  outcome: "accepted" | "late" | "duplicate";
};
export type InputTiming = {
  accepted: number;
  late: number;
  duplicate: number;
  missing: number;
  queued: number;
  receipts: InputReceipt[];
};
export const emptyInputTiming = (): InputTiming => ({
  accepted: 0,
  late: 0,
  duplicate: 0,
  missing: 0,
  queued: 0,
  receipts: [],
});
export type StateMessage = {
  type: "baseline" | "snapshot";
  tick: number;
  serverTime: number;
  playerId: string;
  inputEpoch: number;
  roomGeneration: number;
  eventCursor: number;
  players: PlayerState[];
  projectiles: ProjectileView[];
  rules: RoomRules;
  stats: ServerStats;
  inputTiming: InputTiming;
  reason: string;
};
export type ProjectileView = {
  id: number;
  ownerSlot: 1 | 2;
  x: number;
  y: number;
  aimQ: number;
};
export type ShotEvent = {
  type: "shot";
  eventId: number;
  projectileId: number;
  ownerId: string;
  ownerSlot: 1 | 2;
  sourceInputEpoch: number;
  sourceTick: number;
  x: number;
  y: number;
  aimQ: number;
};
export type TerrainImpactEvent = {
  type: "impact";
  eventId: number;
  projectileId: number;
  target: "terrain";
  x: number;
  y: number;
  normalX: -1 | 0 | 1;
  normalY: -1 | 0 | 1;
};
export type PlayerImpactEvent = Omit<TerrainImpactEvent, "target"> & {
  target: "player";
  targetId: string;
};
export type CombatEvent = ShotEvent | TerrainImpactEvent | PlayerImpactEvent;
export type EventBatch = {
  type: "events";
  roomGeneration: number;
  tick: number;
  events: CombatEvent[];
};
export type ServerMessage =
  | StateMessage
  | EventBatch
  | { type: "pong"; nonce: number; tick: number; serverTime: number }
  | { type: "rejected"; reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function aim(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= AIM_MIN &&
    (value as number) <= AIM_MAX
  );
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160;
}
export function parseClient(raw: string): ClientMessage {
  if (new TextEncoder().encode(raw).byteLength > LIMITS.messageBytes)
    throw new Error("Message exceeds 2 KiB");
  const value: unknown = JSON.parse(raw);
  if (!record(value)) throw new Error("Expected message object");
  switch (value.type) {
    case "hello":
      if (
        keys(value, ["type", "protocol", "content"]) &&
        integer(value.protocol) &&
        text(value.content)
      )
        return value as ClientMessage;
      break;
    case "input":
      if (
        keys(value, [
          "type",
          "inputEpoch",
          "tick",
          "moveX",
          "jumpPressed",
          "jetHeld",
          "aimQ",
          "fire",
        ]) &&
        integer(value.inputEpoch) &&
        integer(value.tick) &&
        [-1, 0, 1].includes(value.moveX as number) &&
        typeof value.jumpPressed === "boolean" &&
        typeof value.jetHeld === "boolean" &&
        aim(value.aimQ) &&
        typeof value.fire === "boolean"
      )
        return value as InputFrame;
      break;
    case "setJets":
      if (
        keys(value, ["type", "inputEpoch", "enabled"]) &&
        integer(value.inputEpoch) &&
        typeof value.enabled === "boolean"
      )
        return value as ClientMessage;
      break;
    case "ping":
      if (keys(value, ["type", "nonce"]) && integer(value.nonce))
        return value as ClientMessage;
      break;
    case "suspend":
    case "resync":
    case "reset":
      if (keys(value, ["type", "inputEpoch"]) && integer(value.inputEpoch))
        return value as ClientMessage;
      break;
  }
  throw new Error("Invalid message fields");
}
export function validPlayer(value: unknown): value is PlayerState {
  return (
    record(value) &&
    keys(value, [
      "id",
      "slot",
      "x",
      "y",
      "vx",
      "vy",
      "grounded",
      "coyoteTicksRemaining",
      "jumpBufferTicksRemaining",
      "jetFuelTicksRemaining",
      "jetActive",
      "aimQ",
      "carbineCooldownTicksRemaining",
    ]) &&
    text(value.id) &&
    [1, 2].includes(value.slot as number) &&
    ["x", "y", "vx", "vy"].every((key) => number(value[key])) &&
    typeof value.grounded === "boolean" &&
    integer(value.coyoteTicksRemaining) &&
    value.coyoteTicksRemaining <= MOVEMENT.coyoteTicks &&
    integer(value.jumpBufferTicksRemaining) &&
    value.jumpBufferTicksRemaining <= MOVEMENT.jumpBufferTicks &&
    integer(value.jetFuelTicksRemaining) &&
    value.jetFuelTicksRemaining <= JETS.fuelTicks &&
    typeof value.jetActive === "boolean" &&
    aim(value.aimQ) &&
    integer(value.carbineCooldownTicksRemaining) &&
    value.carbineCooldownTicksRemaining <= CARBINE.cooldownTicks
  );
}

function validProjectile(value: unknown): value is ProjectileView {
  return (
    record(value) &&
    keys(value, ["id", "ownerSlot", "x", "y", "aimQ"]) &&
    integer(value.id) &&
    value.id > 0 &&
    [1, 2].includes(value.ownerSlot as number) &&
    number(value.x) &&
    number(value.y) &&
    aim(value.aimQ)
  );
}

function validCombatEvent(value: unknown): value is CombatEvent {
  if (!record(value)) return false;
  if (value.type === "shot")
    return (
      keys(value, [
        "type",
        "eventId",
        "projectileId",
        "ownerId",
        "ownerSlot",
        "sourceInputEpoch",
        "sourceTick",
        "x",
        "y",
        "aimQ",
      ]) &&
      integer(value.eventId) &&
      value.eventId > 0 &&
      integer(value.projectileId) &&
      value.projectileId > 0 &&
      text(value.ownerId) &&
      [1, 2].includes(value.ownerSlot as number) &&
      integer(value.sourceInputEpoch) &&
      integer(value.sourceTick) &&
      number(value.x) &&
      number(value.y) &&
      aim(value.aimQ)
    );
  if (value.type !== "impact") return false;
  const normal = (input: unknown) => [-1, 0, 1].includes(input as number);
  const base =
    integer(value.eventId) &&
    value.eventId > 0 &&
    integer(value.projectileId) &&
    value.projectileId > 0 &&
    number(value.x) &&
    number(value.y) &&
    normal(value.normalX) &&
    normal(value.normalY);
  if (value.target === "terrain")
    return (
      keys(value, [
        "type",
        "eventId",
        "projectileId",
        "target",
        "x",
        "y",
        "normalX",
        "normalY",
      ]) && base
    );
  return (
    value.target === "player" &&
    keys(value, [
      "type",
      "eventId",
      "projectileId",
      "target",
      "targetId",
      "x",
      "y",
      "normalX",
      "normalY",
    ]) &&
    base &&
    text(value.targetId)
  );
}
function validInputTiming(value: unknown): value is InputTiming {
  return (
    record(value) &&
    keys(value, [
      "accepted",
      "late",
      "duplicate",
      "missing",
      "queued",
      "receipts",
    ]) &&
    ["accepted", "late", "duplicate", "missing", "queued"].every((key) =>
      integer(value[key]),
    ) &&
    Array.isArray(value.receipts) &&
    value.receipts.length <= 6 &&
    value.receipts.every(
      (r) =>
        record(r) &&
        keys(r, [
          "inputEpoch",
          "tick",
          "receivedTick",
          "receivedAt",
          "outcome",
        ]) &&
        integer(r.inputEpoch) &&
        integer(r.tick) &&
        integer(r.receivedTick) &&
        number(r.receivedAt) &&
        ["accepted", "late", "duplicate"].includes(r.outcome as string),
    )
  );
}
export function validRules(value: unknown): value is RoomRules {
  return (
    record(value) &&
    keys(value, ["jetsEnabled"]) &&
    typeof value.jetsEnabled === "boolean"
  );
}
export function parseServer(raw: string): ServerMessage {
  if (new TextEncoder().encode(raw).byteLength > LIMITS.serverMessageBytes)
    throw new Error("Server message too large");
  const value: unknown = JSON.parse(raw);
  if (!record(value)) throw new Error("Invalid server message");
  if (
    value.type === "rejected" &&
    keys(value, ["type", "reason"]) &&
    text(value.reason)
  )
    return value as ServerMessage;
  if (
    value.type === "pong" &&
    keys(value, ["type", "nonce", "tick", "serverTime"]) &&
    integer(value.nonce) &&
    integer(value.tick) &&
    number(value.serverTime)
  )
    return value as ServerMessage;
  if (
    value.type === "events" &&
    keys(value, ["type", "roomGeneration", "tick", "events"]) &&
    integer(value.roomGeneration) &&
    integer(value.tick) &&
    Array.isArray(value.events) &&
    value.events.length > 0 &&
    value.events.length <= LIMITS.eventBatch &&
    value.events.every(validCombatEvent) &&
    (value.events as CombatEvent[]).every(
      (event, index) =>
        event.eventId === (value.events as CombatEvent[])[0]!.eventId + index,
    )
  )
    return value as EventBatch;
  if (
    (value.type === "baseline" || value.type === "snapshot") &&
    keys(value, [
      "type",
      "tick",
      "serverTime",
      "playerId",
      "inputEpoch",
      "roomGeneration",
      "eventCursor",
      "players",
      "projectiles",
      "rules",
      "stats",
      "inputTiming",
      "reason",
    ]) &&
    integer(value.tick) &&
    integer(value.inputEpoch) &&
    integer(value.roomGeneration) &&
    integer(value.eventCursor) &&
    number(value.serverTime) &&
    text(value.playerId) &&
    text(value.reason) &&
    Array.isArray(value.players) &&
    value.players.length <= 2 &&
    value.players.every(validPlayer) &&
    Array.isArray(value.projectiles) &&
    value.projectiles.length <= CARBINE.roomProjectileCap &&
    value.projectiles.every(validProjectile) &&
    record(value.stats) &&
    validInputTiming(value.inputTiming) &&
    validRules(value.rules)
  ) {
    const fields = [
      "tickP95",
      "tickP99",
      "scheduleMs",
      "overruns",
      "lateInputs",
      "connections",
      "queuedInputs",
      "rssMB",
      "inBytes",
      "outBytes",
      "projectiles",
      "shots",
      "terrainImpacts",
      "playerImpacts",
      "expiredProjectiles",
      "capacityDrops",
    ];
    if (
      keys(value.stats, fields) &&
      fields.every((key) =>
        number((value.stats as Record<string, unknown>)[key]),
      ) &&
      new Set(value.players.map((player) => player.id)).size ===
        value.players.length &&
      new Set(value.projectiles.map((projectile) => projectile.id)).size ===
        value.projectiles.length &&
      value.players.some((player) => player.id === value.playerId)
    )
      return value as StateMessage;
  }
  throw new Error("Invalid server message");
}
export function percentile(samples: readonly number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  ]!;
}
export class Samples {
  values: number[] = [];
  constructor(readonly capacity = 3600) {}
  add(value: number) {
    if (!Number.isFinite(value)) return;
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }
  summary() {
    return {
      count: this.values.length,
      p50: percentile(this.values, 0.5),
      p95: percentile(this.values, 0.95),
      p99: percentile(this.values, 0.99),
      max: Math.max(0, ...this.values),
    };
  }
}

export function parseTrace(value: unknown): Trace {
  if (
    !record(value) ||
    !keys(value, ["version", "contentVersion", "initial", "inputs", "rules"]) ||
    value.version !== TRACE_VERSION ||
    value.contentVersion !== CONTENT_VERSION ||
    !validPlayer(value.initial) ||
    !validRules(value.rules) ||
    !Array.isArray(value.inputs) ||
    value.inputs.length > 10000 ||
    !value.inputs.every(
      (input) =>
        record(input) &&
        keys(input, ["moveX", "jumpPressed", "jetHeld", "aimQ", "fire"]) &&
        [-1, 0, 1].includes(input.moveX as number) &&
        typeof input.jumpPressed === "boolean" &&
        typeof input.jetHeld === "boolean" &&
        aim(input.aimQ) &&
        typeof input.fire === "boolean",
    )
  )
    throw new Error("Invalid or incompatible trace");
  return value as Trace;
}
