import RAPIER from "@dimforge/rapier2d-compat";

export const DT = 1 / 60;
export const TICK_MS = 1000 / 60;
export const CONTENT_VERSION = "playground-2";
export const TRACE_VERSION = 2;
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
export type Input = { moveX: -1 | 0 | 1; jumpPressed: boolean };
export const NEUTRAL: Input = { moveX: 0, jumpPressed: false };
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
};
export const ROOM = {
  width: 24,
  height: 13.5,
  solids: [
    { x: 0, y: -0.5, width: 24, height: 1 },
    { x: -12.5, y: 6.5, width: 1, height: 14 },
    { x: 12.5, y: 6.5, width: 1, height: 14 },
    { x: -4, y: 1.25, width: 4, height: 0.5 },
    { x: 3, y: 2.75, width: 4, height: 0.5 },
    { x: -8, y: 4, width: 3, height: 0.5 },
  ],
} as const;

let initialization: Promise<void> | undefined;
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
  step(state: PlayerState, input: Input): PlayerState {
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
    const vy = Math.max(
      -MOVEMENT.fall,
      (launched ? MOVEMENT.jump : state.vy) - MOVEMENT.gravity * DT,
    );
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
    if (grounded || launched) coyote = 0;
    else if (state.grounded) coyote = MOVEMENT.coyoteTicks;
    else coyote = Math.max(0, coyote - 1);
    return {
      ...state,
      x: state.x + horizontal.x + vertical.x,
      y: state.y + horizontal.y + vertical.y,
      vx: resolvedVx,
      vy: resolvedVy,
      grounded,
      coyoteTicksRemaining: coyote,
      jumpBufferTicksRemaining: Math.max(0, buffer - 1),
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
  inputs: Input[];
};
export function fixtureTrace(): Trace {
  const inputs: Input[] = Array.from({ length: 900 }, (_, tick) => ({
    moveX: (tick % 360 < 180 ? 1 : -1) as -1 | 1,
    jumpPressed: tick % 45 === 10,
  }));
  return {
    version: TRACE_VERSION,
    contentVersion: CONTENT_VERSION,
    initial: spawnState("fixture", 1),
    inputs,
  };
}
export function replay(trace: Trace): PlayerState[] {
  const sim = new Simulation();
  let state = { ...trace.initial };
  const states: PlayerState[] = [];
  try {
    for (const input of trace.inputs) {
      state = sim.step(state, input);
      states.push(state);
    }
  } finally {
    sim.dispose();
  }
  return states;
}
