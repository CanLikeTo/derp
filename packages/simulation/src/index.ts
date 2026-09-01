import RAPIER from "@dimforge/rapier2d-compat";

export const DT = 1 / 60;
export const TICK_MS = 1000 / 60;
export const CONTENT_VERSION = "playground-4";
export const TRACE_VERSION = 4;
export const AIM_STEPS = 65_536;
export const AIM_HALF_TURN = AIM_STEPS / 2;
export const AIM_QUARTER_TURN = AIM_STEPS / 4;
export const AIM_MIN = -AIM_HALF_TURN;
export const AIM_MAX = AIM_HALF_TURN - 1;
export const AIM_DEAD_ZONE = 0.1;
export const MOVEMENT = {
  width: 0.8,
  height: 1.8,
  speed: 8,
  jump: 12,
  gravity: 30,
  fall: 20,
  margin: 0.01,
  coyoteTicks: 6,
  jumpBufferTicks: 6,
} as const;
export const JETS = {
  fuelTicks: 45,
  acceleration: 45,
  upwardSpeed: 12,
  refillPerTick: 1,
} as const;
export type RoomRules = { jetsEnabled: boolean };
export const DISABLED_RULES: RoomRules = { jetsEnabled: false };
export type Input = {
  moveX: -1 | 0 | 1;
  jumpPressed: boolean;
  jetHeld: boolean;
  aimQ: number;
};
export const neutralInput = (aimQ: number): Input => ({
  moveX: 0,
  jumpPressed: false,
  jetHeld: false,
  aimQ: wrapAimQ(aimQ),
});
// Convenient zero-angle fixture. Runtime neutral ticks must use neutralInput(state.aimQ).
export const NEUTRAL: Input = neutralInput(0);
export type PlayerState = {
  id: string;
  slot: 1 | 2;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  coyoteTicksRemaining: number;
  jumpBufferTicksRemaining: number;
  jetFuelTicksRemaining: number;
  jetActive: boolean;
  aimQ: number;
};
export const ROOM = {
  width: 24,
  height: 13.5,
  solids: [
    { x: 0, y: 13.25, width: 24, height: 0.5 },
    { x: 0, y: -0.5, width: 24, height: 1 },
    { x: -12.5, y: 6.5, width: 1, height: 14 },
    { x: 12.5, y: 6.5, width: 1, height: 14 },
    { x: -4, y: 1.25, width: 4, height: 0.5 },
    { x: 3, y: 2.75, width: 4, height: 0.5 },
    { x: -8, y: 4, width: 3, height: 0.5 },
  ],
} as const;

let initialization: Promise<void> | undefined;

export function wrapAimQ(value: number): number {
  const rounded = Math.round(value);
  return (
    ((((rounded + AIM_HALF_TURN) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS) -
    AIM_HALF_TURN
  );
}

export function aimQFromVector(dx: number, dy: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0))
    return 0;
  return wrapAimQ((Math.atan2(dy, dx) / (Math.PI * 2)) * AIM_STEPS);
}

export function aimQToRadians(aimQ: number): number {
  return (wrapAimQ(aimQ) / AIM_STEPS) * Math.PI * 2;
}

export function aimQToDegrees(aimQ: number): number {
  return (wrapAimQ(aimQ) / AIM_STEPS) * 360;
}

// The signed representation maps an exact antipode to -32768: clockwise.
export function shortestAimDelta(from: number, to: number): number {
  return wrapAimQ(to - from);
}

export function interpolateAimQ(from: number, to: number, t: number): number {
  return wrapAimQ(
    from + shortestAimDelta(from, to) * Math.min(1, Math.max(0, t)),
  );
}

export function initializePhysics(): Promise<void> {
  return (initialization ??= RAPIER.init());
}
export function spawnState(id: string, slot: 1 | 2): PlayerState {
  return {
    id,
    slot,
    x: slot === 1 ? -8 : 8,
    y: 0.92,
    vx: 0,
    vy: 0,
    grounded: false,
    coyoteTicksRemaining: 0,
    jumpBufferTicksRemaining: 0,
    jetFuelTicksRemaining: JETS.fuelTicks,
    jetActive: false,
    aimQ: slot === 1 ? 0 : AIM_MIN,
  };
}

// Each controller sees only immutable terrain. Players intentionally never block one another.
export class Simulation {
  private world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  private collider: RAPIER.Collider;
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    for (const solid of ROOM.solids)
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(solid.width / 2, solid.height / 2)
          .setTranslation(solid.x, solid.y)
          .setCollisionGroups(0x00010002),
      );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        MOVEMENT.width / 2,
        MOVEMENT.height / 2,
      ).setCollisionGroups(0x00020001),
    );
    this.controller = this.world.createCharacterController(MOVEMENT.margin);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.world.timestep = DT;
    this.world.step();
  }
  step(state: PlayerState, input: Input, rules: RoomRules): PlayerState {
    this.collider.setTranslation({ x: state.x, y: state.y });
    // Refresh broad phase after restoring a prediction snapshot, including teleports.
    this.world.step();
    const vx = input.moveX * MOVEMENT.speed;
    let buffer = input.jumpPressed
      ? MOVEMENT.jumpBufferTicks
      : state.jumpBufferTicksRemaining;
    let coyote = state.coyoteTicksRemaining;
    let launched = buffer > 0 && (state.grounded || coyote > 0);
    if (launched) buffer = coyote = 0;
    const jetActive =
      rules.jetsEnabled && input.jetHeld && state.jetFuelTicksRemaining > 0;
    let fuel = rules.jetsEnabled
      ? state.jetFuelTicksRemaining - (jetActive ? 1 : 0)
      : JETS.fuelTicks;
    let vy = Math.max(
      -MOVEMENT.fall,
      (launched ? MOVEMENT.jump : state.vy) -
        MOVEMENT.gravity * DT +
        (jetActive ? JETS.acceleration * DT : 0),
    );
    if (jetActive) vy = Math.min(vy, JETS.upwardSpeed);
    this.controller.computeColliderMovement(
      this.collider,
      { x: vx * DT, y: 0 },
      undefined,
      0x00020001,
    );
    const horizontal = this.controller.computedMovement();
    let resolvedVx = vx;
    // Separate sweeps avoid corner/side-contact cancellation of downward motion
    // when continuously pushing into a wall. This adapter supports rectangles only.
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const normal = this.controller.computedCollision(i)?.normal1;
      if (normal && Math.abs(normal.x) > 0.5 && vx * normal.x < 0)
        resolvedVx = 0;
    }
    this.collider.setTranslation({
      x: state.x + horizontal.x,
      y: state.y + horizontal.y,
    });
    this.world.step();
    this.controller.computeColliderMovement(
      this.collider,
      { x: 0, y: vy * DT },
      undefined,
      0x00020001,
    );
    const vertical = this.controller.computedMovement();
    let grounded = this.controller.computedGrounded();
    let resolvedVy = grounded && vy < 0 ? 0 : vy;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const normal = this.controller.computedCollision(i)?.normal1;
      if (normal && Math.abs(normal.y) > 0.5 && vy * normal.y < 0)
        resolvedVy = 0;
    }
    // Landing consumes the tap now, without a second sweep or extra simulation time.
    if (grounded && vy < 0 && buffer > 0) {
      launched = true;
      buffer = coyote = 0;
      resolvedVy = MOVEMENT.jump;
      grounded = false;
    }
    if (grounded || launched || jetActive) coyote = 0;
    else if (state.grounded && (!rules.jetsEnabled || !state.jetActive))
      coyote = MOVEMENT.coyoteTicks;
    else coyote = Math.max(0, coyote - 1);
    if (rules.jetsEnabled && grounded && !input.jetHeld)
      fuel = Math.min(JETS.fuelTicks, fuel + JETS.refillPerTick);
    return {
      ...state,
      aimQ: wrapAimQ(input.aimQ),
      x: state.x + horizontal.x + vertical.x,
      y: state.y + horizontal.y + vertical.y,
      vx: resolvedVx,
      vy: resolvedVy,
      grounded,
      coyoteTicksRemaining: coyote,
      jumpBufferTicksRemaining: Math.max(0, buffer - 1),
      jetFuelTicksRemaining: fuel,
      jetActive,
    };
  }
  dispose() {
    this.world.free();
  }
}

export type Trace = {
  version: typeof TRACE_VERSION;
  contentVersion: typeof CONTENT_VERSION;
  initial: PlayerState;
  rules: RoomRules;
  inputs: Input[];
};
export function fixtureTrace(): Trace {
  const inputs: Input[] = Array.from({ length: 900 }, (_, tick) => ({
    moveX: (tick % 360 < 180 ? 1 : -1) as -1 | 1,
    jumpPressed: tick % 45 === 10,
    jetHeld: false,
    aimQ: wrapAimQ(tick * 193),
  }));
  return {
    version: TRACE_VERSION,
    contentVersion: CONTENT_VERSION,
    initial: spawnState("fixture", 1),
    rules: { ...DISABLED_RULES },
    inputs,
  };
}
export function replay(trace: Trace): PlayerState[] {
  const sim = new Simulation();
  let state = { ...trace.initial };
  const states: PlayerState[] = [];
  try {
    for (const input of trace.inputs) {
      state = sim.step(state, input, trace.rules);
      states.push(state);
    }
  } finally {
    sim.dispose();
  }
  return states;
}
