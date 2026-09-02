import {
  CARBINE,
  DT,
  MOVEMENT,
  ROOM,
  Simulation,
  aimUnitVector,
  carbineMuzzle,
  neutralInput,
  spawnState,
  sweepSegmentAabb,
  type PlayerState,
  type Point,
  type RoomRules,
  type SweepHit,
} from "@derp/simulation";
import {
  LIMITS,
  emptyInputTiming,
  type CombatEvent,
  type InputFrame,
  type InputTiming,
  type PlayerImpactEvent,
  type ProjectileView,
  type ShotEvent,
  type TerrainImpactEvent,
} from "@derp/protocol";

export type Participant = {
  state: PlayerState;
  epoch: number;
  active: boolean;
  inputs: Map<number, InputFrame>;
  timing: InputTiming;
};

type Projectile = ProjectileView & {
  ownerId: string;
  ageTicks: number;
  sourceInputEpoch: number;
  sourceTick: number;
};

type Collision = SweepHit &
  (
    | { target: "terrain"; index: number }
    | { target: "player"; player: PlayerState }
  );

export class Room {
  rules: RoomRules = { jetsEnabled: false };
  tick = 0;
  lateInputs = 0;
  roomGeneration = 1;
  eventCursor = 0;
  shots = 0;
  terrainImpacts = 0;
  playerImpacts = 0;
  expiredProjectiles = 0;
  capacityDrops = 0;
  private nextEpoch = 1;
  private nextProjectileId = 1;
  private simulation = new Simulation();
  private projectiles: Projectile[] = [];
  participants = new Map<string, Participant>();

  join(id: string): Participant | undefined {
    if (this.participants.size >= 2 || this.participants.has(id)) return;
    const slot = [...this.participants.values()].some(
      (peer) => peer.state.slot === 1,
    )
      ? 2
      : 1;
    const peer = {
      state: spawnState(id, slot),
      epoch: this.nextEpoch++,
      active: false,
      inputs: new Map<number, InputFrame>(),
      timing: emptyInputTiming(),
    };
    this.participants.set(id, peer);
    return peer;
  }

  leave(id: string) {
    this.participants.delete(id);
    if (!this.participants.size) this.newCombatGeneration();
  }

  baseline(id: string) {
    const peer = this.participants.get(id);
    if (!peer) return;
    peer.epoch = this.nextEpoch++;
    peer.inputs.clear();
    peer.state = {
      ...peer.state,
      jumpBufferTicksRemaining: 0,
      jetActive: false,
    };
    peer.active = true;
    return peer;
  }

  suspend(id: string) {
    const peer = this.participants.get(id);
    if (peer) {
      peer.active = false;
      peer.inputs.clear();
      peer.state = {
        ...peer.state,
        jumpBufferTicksRemaining: 0,
        jetActive: false,
      };
    }
  }

  input(id: string, input: InputFrame, receivedAt = performance.now()) {
    const peer = this.participants.get(id);
    if (!peer || input.inputEpoch !== peer.epoch || !peer.active) return;
    const receipt = (outcome: "accepted" | "late" | "duplicate") => {
      peer.timing[outcome]++;
      peer.timing.receipts.push({
        inputEpoch: input.inputEpoch,
        tick: input.tick,
        receivedTick: this.tick,
        receivedAt,
        outcome,
      });
      if (peer.timing.receipts.length > 6) peer.timing.receipts.shift();
    };
    if (input.tick <= this.tick) {
      receipt("late");
      this.lateInputs++;
      return;
    }
    if (input.tick > this.tick + LIMITS.futureTicks)
      throw new Error(
        "Input exceeds future window; reconnect for a fresh baseline",
      );
    if (!peer.inputs.has(input.tick)) {
      peer.inputs.set(input.tick, input);
      receipt("accepted");
    } else receipt("duplicate");
  }

  step(): CombatEvent[] {
    this.tick++;
    const peers = [...this.participants.values()].sort(
      (a, b) =>
        a.state.slot - b.state.slot || a.state.id.localeCompare(b.state.id),
    );
    const previous = new Map(
      peers.map((peer) => [peer.state.id, { ...peer.state }] as const),
    );
    const authorized: Array<{ peer: Participant; input: InputFrame }> = [];

    for (const peer of peers) {
      const input = peer.active ? peer.inputs.get(this.tick) : undefined;
      if (peer.active && !input) peer.timing.missing++;
      const result = this.simulation.stepWithActions(
        peer.state,
        input ?? neutralInput(peer.state.aimQ),
        this.rules,
      );
      peer.state = result.state;
      if (result.shotAuthorized && input) authorized.push({ peer, input });
      peer.inputs.delete(this.tick);
    }

    const events: CombatEvent[] = [];
    const survivors: Projectile[] = [];
    for (const projectile of [...this.projectiles].sort(
      (a, b) => a.id - b.id,
    )) {
      const direction = aimUnitVector(projectile.aimQ);
      const start = { x: projectile.x, y: projectile.y };
      const end = {
        x: start.x + direction.x * CARBINE.speed * DT,
        y: start.y + direction.y * CARBINE.speed * DT,
      };
      const hit = this.firstCollision(projectile, start, end, peers, previous);
      if (hit) {
        events.push(this.impactEvent(projectile.id, hit));
        continue;
      }
      const ageTicks = projectile.ageTicks + 1;
      if (ageTicks >= CARBINE.lifetimeTicks) {
        this.expiredProjectiles++;
        continue;
      }
      survivors.push({ ...projectile, ...end, ageTicks });
    }
    this.projectiles = survivors;

    for (const { peer, input } of authorized) {
      if (this.projectiles.length >= CARBINE.roomProjectileCap) {
        this.capacityDrops++;
        continue;
      }
      const projectileId = this.nextProjectileId++;
      const muzzle = carbineMuzzle(peer.state);
      const projectile: Projectile = {
        id: projectileId,
        ownerId: peer.state.id,
        ownerSlot: peer.state.slot,
        x: muzzle.x,
        y: muzzle.y,
        aimQ: peer.state.aimQ,
        ageTicks: 0,
        sourceInputEpoch: input.inputEpoch,
        sourceTick: input.tick,
      };
      events.push(this.shotEvent(projectile));
      this.shots++;
      const blocked = this.firstTerrainCollision(
        { x: peer.state.x, y: peer.state.y },
        muzzle,
      );
      if (blocked) events.push(this.impactEvent(projectileId, blocked));
      else this.projectiles.push(projectile);
    }
    if (events.length > LIMITS.eventBatch)
      throw new Error("Combat event batch exceeded protocol bound");
    return events;
  }

  private firstCollision(
    projectile: Projectile,
    start: Point,
    end: Point,
    peers: Participant[],
    previous: Map<string, PlayerState>,
  ): Collision | undefined {
    let best: Collision | undefined = this.firstTerrainCollision(start, end);
    for (const peer of peers) {
      if (peer.state.id === projectile.ownerId) continue;
      const before = previous.get(peer.state.id) ?? peer.state;
      const hit = sweepSegmentAabb(
        { x: start.x - before.x, y: start.y - before.y },
        { x: end.x - peer.state.x, y: end.y - peer.state.y },
        { x: 0, y: 0, width: MOVEMENT.width, height: MOVEMENT.height },
        CARBINE.halfExtent,
      );
      if (!hit) continue;
      const candidate: Collision = {
        ...hit,
        x: start.x + (end.x - start.x) * hit.toi,
        y: start.y + (end.y - start.y) * hit.toi,
        target: "player",
        player: peer.state,
      };
      if (this.precedes(candidate, best)) best = candidate;
    }
    return best;
  }

  private firstTerrainCollision(
    start: Point,
    end: Point,
  ): (SweepHit & { target: "terrain"; index: number }) | undefined {
    let best: (SweepHit & { target: "terrain"; index: number }) | undefined;
    ROOM.solids.forEach((solid, index) => {
      const hit = sweepSegmentAabb(start, end, solid, CARBINE.halfExtent);
      const candidate = hit && { ...hit, target: "terrain" as const, index };
      if (candidate && this.precedes(candidate, best)) best = candidate;
    });
    return best;
  }

  private precedes(candidate: Collision, current: Collision | undefined) {
    if (!current) return true;
    if (candidate.toi < current.toi - CARBINE.collisionEpsilon) return true;
    if (Math.abs(candidate.toi - current.toi) > CARBINE.collisionEpsilon)
      return false;
    if (candidate.target !== current.target)
      return candidate.target === "terrain";
    if (candidate.target === "terrain" && current.target === "terrain")
      return candidate.index < current.index;
    if (candidate.target === "player" && current.target === "player")
      return (
        candidate.player.slot < current.player.slot ||
        (candidate.player.slot === current.player.slot &&
          candidate.player.id.localeCompare(current.player.id) < 0)
      );
    return false;
  }

  private shotEvent(projectile: Projectile): ShotEvent {
    return {
      type: "shot",
      eventId: ++this.eventCursor,
      projectileId: projectile.id,
      ownerId: projectile.ownerId,
      ownerSlot: projectile.ownerSlot,
      sourceInputEpoch: projectile.sourceInputEpoch,
      sourceTick: projectile.sourceTick,
      x: projectile.x,
      y: projectile.y,
      aimQ: projectile.aimQ,
    };
  }

  private impactEvent(
    projectileId: number,
    hit: Collision,
  ): TerrainImpactEvent | PlayerImpactEvent {
    if (hit.target === "player") {
      this.playerImpacts++;
      return {
        type: "impact",
        eventId: ++this.eventCursor,
        projectileId,
        target: "player",
        targetId: hit.player.id,
        x: hit.x,
        y: hit.y,
        normalX: hit.normalX,
        normalY: hit.normalY,
      };
    }
    this.terrainImpacts++;
    return {
      type: "impact",
      eventId: ++this.eventCursor,
      projectileId,
      target: "terrain",
      x: hit.x,
      y: hit.y,
      normalX: hit.normalX,
      normalY: hit.normalY,
    };
  }

  reset() {
    this.newCombatGeneration();
    for (const peer of this.participants.values())
      peer.state = spawnState(peer.state.id, peer.state.slot);
  }

  private newCombatGeneration() {
    this.roomGeneration++;
    this.eventCursor = 0;
    this.nextProjectileId = 1;
    this.projectiles = [];
  }

  snapshot() {
    return [...this.participants.values()]
      .sort((a, b) => a.state.slot - b.state.slot)
      .map((peer) => ({ ...peer.state }));
  }

  projectileSnapshot(): ProjectileView[] {
    return this.projectiles
      .slice()
      .sort((a, b) => a.id - b.id)
      .map(({ id, ownerSlot, x, y, aimQ }) => ({
        id,
        ownerSlot,
        x,
        y,
        aimQ,
      }));
  }

  dispose() {
    this.simulation.dispose();
  }
}
