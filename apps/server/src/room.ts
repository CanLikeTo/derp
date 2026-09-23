import {
  CARBINE,
  DUEL,
  DT,
  MOVEMENT,
  ROOM,
  SPAWNS,
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
    | { target: "player"; player: Participant }
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
  damage = 0;
  deaths = 0;
  respawns = 0;
  protectedHits = 0;
  transitions: Array<{ id: string; reason: "death" | "respawn" }> = [];
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
      state: {
        ...spawnState(id, slot),
        spawnProtectedUntilTick: this.tick + DUEL.protectionTicks + 1,
      },
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
    if (
      !peer ||
      input.inputEpoch !== peer.epoch ||
      input.lifeId !== peer.state.lifeId ||
      !peer.active ||
      peer.state.health === 0
    )
      return;
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
    this.transitions = [];
    const peers = [...this.participants.values()].sort(
      (a, b) =>
        a.state.slot - b.state.slot || a.state.id.localeCompare(b.state.id),
    );
    const reserved = new Set<number>();
    const events: CombatEvent[] = [];
    for (const peer of peers) {
      if (
        peer.state.respawnAtTick === null ||
        peer.state.respawnAtTick > this.tick
      )
        continue;
      const opponent = peers.find(
        (other) => other !== peer && other.state.health > 0,
      );
      const available = SPAWNS.map((spawn, index) => ({ spawn, index })).filter(
        ({ index }) => !reserved.has(index),
      );
      available.sort((a, b) => {
        if (opponent) {
          const da =
            (a.spawn.x - opponent.state.x) ** 2 +
            (a.spawn.y - opponent.state.y) ** 2;
          const db =
            (b.spawn.x - opponent.state.x) ** 2 +
            (b.spawn.y - opponent.state.y) ** 2;
          if (da !== db) return db - da;
        }
        const aOwn = a.spawn.slot === peer.state.slot ? 0 : 1;
        const bOwn = b.spawn.slot === peer.state.slot ? 0 : 1;
        return aOwn - bOwn || a.index - b.index;
      });
      const selected = available[0]!;
      reserved.add(selected.index);
      peer.state = {
        ...spawnState(peer.state.id, peer.state.slot),
        x: selected.spawn.x,
        y: selected.spawn.y,
        aimQ: selected.spawn.x < 0 ? 0 : -32768,
        lifeId: peer.state.lifeId + 1,
        spawnProtectedUntilTick: this.tick + DUEL.protectionTicks,
      };
      peer.epoch = this.nextEpoch++;
      peer.inputs.clear();
      this.respawns++;
      this.transitions.push({ id: peer.state.id, reason: "respawn" });
      events.push({
        type: "respawn",
        eventId: ++this.eventCursor,
        player: { ...peer.state },
      });
    }
    for (const peer of peers)
      if (
        peer.state.spawnProtectedUntilTick !== 0 &&
        peer.state.spawnProtectedUntilTick <= this.tick
      )
        peer.state.spawnProtectedUntilTick = 0;
    const previous = new Map(
      peers.map((peer) => [peer.state.id, { ...peer.state }] as const),
    );
    const authorized: Array<{ state: PlayerState; input: InputFrame }> = [];

    for (const peer of peers) {
      const input = peer.active ? peer.inputs.get(this.tick) : undefined;
      if (peer.active && peer.state.health > 0 && !input) peer.timing.missing++;
      const result = this.simulation.stepWithActions(
        peer.state,
        input ?? neutralInput(peer.state.aimQ),
        this.rules,
      );
      peer.state = result.state;
      if (result.shotAuthorized && input) {
        peer.state.spawnProtectedUntilTick = 0;
        authorized.push({ state: { ...peer.state }, input });
      }
      peer.inputs.delete(this.tick);
    }

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
        events.push(this.impactEvent(projectile, hit));
        if (hit.target === "player" && hit.player.state.health === 0) {
          events.push({
            type: "death",
            eventId: ++this.eventCursor,
            player: { ...hit.player.state },
            killerId: projectile.ownerId,
            killerLifeId: projectile.ownerLifeId,
            projectileId: projectile.id,
          });
          this.transitions.push({ id: hit.player.state.id, reason: "death" });
        }
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

    for (const { state, input } of authorized) {
      if (this.projectiles.length >= CARBINE.roomProjectileCap) {
        this.capacityDrops++;
        continue;
      }
      const projectileId = this.nextProjectileId++;
      const muzzle = carbineMuzzle(state);
      const projectile: Projectile = {
        id: projectileId,
        ownerId: state.id,
        ownerLifeId: state.lifeId,
        ownerSlot: state.slot,
        x: muzzle.x,
        y: muzzle.y,
        aimQ: state.aimQ,
        ageTicks: 0,
        sourceInputEpoch: input.inputEpoch,
        sourceTick: input.tick,
      };
      events.push(this.shotEvent(projectile));
      this.shots++;
      const blocked = this.firstTerrainCollision(
        { x: state.x, y: state.y },
        muzzle,
      );
      if (blocked) events.push(this.impactEvent(projectile, blocked));
      else this.projectiles.push(projectile);
    }
    if (events.length > DUEL.maxTickEvents)
      throw new Error("Combat tick exceeded event bound");
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
      if (peer.state.id === projectile.ownerId || peer.state.health === 0)
        continue;
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
        player: peer,
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
        candidate.player.state.slot < current.player.state.slot ||
        (candidate.player.state.slot === current.player.state.slot &&
          candidate.player.state.id.localeCompare(current.player.state.id) < 0)
      );
    return false;
  }

  private shotEvent(projectile: Projectile): ShotEvent {
    return {
      type: "shot",
      eventId: ++this.eventCursor,
      projectileId: projectile.id,
      ownerId: projectile.ownerId,
      ownerLifeId: projectile.ownerLifeId,
      ownerSlot: projectile.ownerSlot,
      sourceInputEpoch: projectile.sourceInputEpoch,
      sourceTick: projectile.sourceTick,
      x: projectile.x,
      y: projectile.y,
      aimQ: projectile.aimQ,
    };
  }

  private impactEvent(
    projectile: Projectile,
    hit: Collision,
  ): TerrainImpactEvent | PlayerImpactEvent {
    if (hit.target === "player") {
      this.playerImpacts++;
      const target = hit.player;
      const protectedHit = this.tick < target.state.spawnProtectedUntilTick;
      const damage = protectedHit ? 0 : DUEL.damage;
      if (protectedHit) this.protectedHits++;
      else this.damage += damage;
      target.state = {
        ...target.state,
        health: Math.max(0, target.state.health - damage),
      };
      if (target.state.health === 0) {
        this.deaths++;
        target.state = {
          ...target.state,
          vx: 0,
          vy: 0,
          grounded: false,
          coyoteTicksRemaining: 0,
          jumpBufferTicksRemaining: 0,
          jetActive: false,
          carbineCooldownTicksRemaining: 0,
          spawnProtectedUntilTick: 0,
          respawnAtTick: this.tick + DUEL.respawnTicks,
        };
        target.inputs.clear();
        target.epoch = this.nextEpoch++;
      }
      return {
        type: "impact",
        eventId: ++this.eventCursor,
        projectileId: projectile.id,
        target: "player",
        targetId: target.state.id,
        targetLifeId: target.state.lifeId,
        ownerId: projectile.ownerId,
        ownerLifeId: projectile.ownerLifeId,
        damage,
        health: target.state.health,
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
      projectileId: projectile.id,
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
      peer.state = {
        ...spawnState(peer.state.id, peer.state.slot),
        spawnProtectedUntilTick: this.tick + DUEL.protectionTicks + 1,
      };
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
      .map(({ id, ownerId, ownerLifeId, ownerSlot, x, y, aimQ }) => ({
        id,
        ownerId,
        ownerLifeId,
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
