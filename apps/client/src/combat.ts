import {
  CARBINE,
  DT,
  ROOM,
  aimUnitVector,
  carbineMuzzle,
  sweepSegmentAabb,
  type PlayerState,
} from "@derp/simulation";
import type {
  CombatEvent,
  EventBatch,
  ProjectileView,
  ShotEvent,
  StateMessage,
} from "@derp/protocol";

export type EffectView = {
  kind: "muzzle" | "impact-terrain" | "impact-player";
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  ownerSlot: 1 | 2;
  expiresTick: number;
};

type Provisional = ProjectileView & {
  key: string;
  sourceTick: number;
  sourceInputEpoch: number;
  ageTicks: number;
};

export class CombatPresentation {
  roomGeneration = 0;
  eventCursor = 0;
  attempts = 0;
  predictedShots = 0;
  confirmations = 0;
  rejections = 0;
  duplicateEvents = 0;
  eventGaps = 0;
  terrainImpacts = 0;
  playerImpacts = 0;
  provisionalTerrainStops = 0;
  provisionalExpiries = 0;
  private provisionalSequence = 0;
  private provisionals = new Map<string, Provisional>();
  private eventProjectiles = new Map<number, ProjectileView>();
  private tombstones = new Set<number>();
  private effects: EffectView[] = [];
  recent: Array<{ tick: number; event: string }> = [];

  baseline(message: StateMessage) {
    this.roomGeneration = message.roomGeneration;
    this.eventCursor = message.eventCursor;
    this.provisionals.clear();
    this.eventProjectiles.clear();
    this.tombstones.clear();
    this.effects = [];
  }

  snapshot(message: StateMessage): boolean {
    if (message.roomGeneration !== this.roomGeneration) return false;
    if (message.eventCursor > this.eventCursor) {
      this.eventGaps++;
      return false;
    }
    const ids = new Set(message.projectiles.map((projectile) => projectile.id));
    for (const id of this.eventProjectiles.keys())
      if (ids.has(id) || this.tombstones.has(id))
        this.eventProjectiles.delete(id);
    for (const id of this.tombstones)
      if (!ids.has(id)) this.tombstones.delete(id);
    for (const [key, projectile] of this.provisionals)
      if (projectile.sourceTick <= message.tick) {
        this.provisionals.delete(key);
        this.rejections++;
      }
    return true;
  }

  receive(batch: EventBatch, localId: string): boolean {
    if (batch.roomGeneration < this.roomGeneration) return true;
    if (batch.roomGeneration > this.roomGeneration) {
      this.eventGaps++;
      return false;
    }
    for (const event of batch.events) {
      if (event.eventId <= this.eventCursor) {
        this.duplicateEvents++;
        continue;
      }
      if (event.eventId !== this.eventCursor + 1) {
        this.eventGaps++;
        return false;
      }
      this.eventCursor = event.eventId;
      this.consume(event, batch.tick, localId);
    }
    return true;
  }

  private consume(event: CombatEvent, tick: number, localId: string) {
    if (event.type === "shot") {
      const key = this.shotKey(
        event.ownerId,
        event.sourceInputEpoch,
        event.sourceTick,
      );
      const predicted = this.provisionals.get(key);
      if (predicted) {
        this.provisionals.delete(key);
        this.confirmations++;
      } else {
        this.addEffect({
          kind: "muzzle",
          x: event.x,
          y: event.y,
          normalX: 0,
          normalY: 0,
          ownerSlot: event.ownerSlot,
          expiresTick: tick + CARBINE.muzzleFlashTicks,
        });
      }
      this.eventProjectiles.set(event.projectileId, {
        id: event.projectileId,
        ownerSlot: event.ownerSlot,
        x: event.x,
        y: event.y,
        aimQ: event.aimQ,
      });
      this.note(
        tick,
        (event.ownerId === localId ? "local" : "remote") +
          " shot " +
          event.projectileId,
      );
      return;
    }
    this.eventProjectiles.delete(event.projectileId);
    this.tombstones.add(event.projectileId);
    if (event.target === "player") this.playerImpacts++;
    else this.terrainImpacts++;
    this.addEffect({
      kind: event.target === "player" ? "impact-player" : "impact-terrain",
      x: event.x,
      y: event.y,
      normalX: event.normalX,
      normalY: event.normalY,
      ownerSlot: 1,
      expiresTick: tick + CARBINE.impactTicks,
    });
    this.note(tick, event.target + " impact " + event.projectileId);
  }

  stepPrediction() {
    for (const [key, projectile] of this.provisionals) {
      const direction = aimUnitVector(projectile.aimQ);
      const end = {
        x: projectile.x + direction.x * CARBINE.speed * DT,
        y: projectile.y + direction.y * CARBINE.speed * DT,
      };
      const blocked = ROOM.solids.some((solid) =>
        sweepSegmentAabb(projectile, end, solid, CARBINE.halfExtent),
      );
      if (blocked) {
        this.provisionals.delete(key);
        this.provisionalTerrainStops++;
        continue;
      }
      projectile.x = end.x;
      projectile.y = end.y;
      projectile.ageTicks++;
      if (projectile.ageTicks >= CARBINE.lifetimeTicks) {
        this.provisionals.delete(key);
        this.provisionalExpiries++;
      }
    }
  }

  predictedShot(player: PlayerState, inputEpoch: number, sourceTick: number) {
    this.attempts++;
    if (this.provisionals.size >= CARBINE.provisionalProjectileCap) return;
    const muzzle = carbineMuzzle(player);
    const key = this.shotKey(player.id, inputEpoch, sourceTick);
    this.provisionals.set(key, {
      key,
      id: -++this.provisionalSequence,
      ownerSlot: player.slot,
      x: muzzle.x,
      y: muzzle.y,
      aimQ: player.aimQ,
      sourceTick,
      sourceInputEpoch: inputEpoch,
      ageTicks: 0,
    });
    this.predictedShots++;
    this.addEffect({
      kind: "muzzle",
      x: muzzle.x,
      y: muzzle.y,
      normalX: 0,
      normalY: 0,
      ownerSlot: player.slot,
      expiresTick: sourceTick + CARBINE.muzzleFlashTicks,
    });
  }

  presentation(authoritative: ProjectileView[], renderTick: number) {
    this.effects = this.effects.filter(
      (effect) => effect.expiresTick > renderTick,
    );
    const byId = new Map<number, ProjectileView>();
    for (const projectile of authoritative)
      if (!this.tombstones.has(projectile.id))
        byId.set(projectile.id, projectile);
    for (const [id, projectile] of this.eventProjectiles)
      if (!byId.has(id) && !this.tombstones.has(id)) byId.set(id, projectile);
    for (const projectile of this.provisionals.values())
      byId.set(projectile.id, projectile);
    return {
      projectiles: [...byId.values()].slice(
        0,
        CARBINE.roomProjectileCap + CARBINE.provisionalProjectileCap,
      ),
      effects: this.effects,
    };
  }

  clear() {
    this.roomGeneration = 0;
    this.eventCursor = 0;
    this.provisionals.clear();
    this.eventProjectiles.clear();
    this.tombstones.clear();
    this.effects = [];
  }

  diagnostics() {
    return {
      roomGeneration: this.roomGeneration,
      eventCursor: this.eventCursor,
      attempts: this.attempts,
      predictedShots: this.predictedShots,
      confirmations: this.confirmations,
      rejections: this.rejections,
      duplicateEvents: this.duplicateEvents,
      eventGaps: this.eventGaps,
      terrainImpacts: this.terrainImpacts,
      playerImpacts: this.playerImpacts,
      provisionalTerrainStops: this.provisionalTerrainStops,
      provisionalExpiries: this.provisionalExpiries,
      provisionals: this.provisionals.size,
      eventProjectiles: this.eventProjectiles.size,
      effects: this.effects.length,
      recent: this.recent.slice(-20),
    };
  }

  private addEffect(effect: EffectView) {
    if (this.effects.length >= CARBINE.effectPoolSize) this.effects.shift();
    this.effects.push(effect);
  }

  private shotKey(ownerId: string, epoch: number, tick: number) {
    return this.roomGeneration + ":" + ownerId + ":" + epoch + ":" + tick;
  }

  private note(tick: number, event: string) {
    this.recent.push({ tick, event });
    if (this.recent.length > 40) this.recent.shift();
  }
}

export function shotMatches(
  event: ShotEvent,
  ownerId: string,
  inputEpoch: number,
  tick: number,
) {
  return (
    event.ownerId === ownerId &&
    event.sourceInputEpoch === inputEpoch &&
    event.sourceTick === tick
  );
}
