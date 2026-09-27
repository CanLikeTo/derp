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
import { LIMITS } from "@derp/protocol";

export type EffectView = {
  kind: "muzzle" | "impact-terrain" | "impact-player" | "impact-protected";
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  ownerSlot: 1 | 2;
  startsTick: number;
  immediate: boolean;
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
  damage = 0;
  protectedHits = 0;
  deaths = 0;
  respawns = 0;
  localDeaths = 0;
  localRespawns = 0;
  provisionalTerrainStops = 0;
  provisionalExpiries = 0;
  private provisionalSequence = 0;
  private provisionals = new Map<string, Provisional>();
  private eventProjectiles = new Map<
    number,
    { projectile: ProjectileView; tick: number }
  >();
  private tombstones = new Map<number, number>();
  private effects: EffectView[] = [];
  private pendingEvents = 0;
  recent: Array<{ tick: number; event: string }> = [];

  baseline(message: StateMessage, preserveTimeline = false) {
    const preserve =
      preserveTimeline && this.roomGeneration === message.roomGeneration;
    this.roomGeneration = message.roomGeneration;
    this.eventCursor = message.eventCursor;
    this.provisionals.clear();
    if (!preserve) {
      this.eventProjectiles.clear();
      this.tombstones.clear();
      this.effects = [];
      this.pendingEvents = 0;
    } else this.effects = this.effects.filter((effect) => !effect.immediate);
  }

  snapshot(message: StateMessage): boolean {
    if (message.roomGeneration !== this.roomGeneration) return false;
    if (message.eventCursor > this.eventCursor) {
      this.eventGaps++;
      return false;
    }
    this.pendingEvents = 0;
    const active = new Set(
      message.projectiles.map((projectile) => projectile.id),
    );
    for (const [id, value] of this.eventProjectiles)
      if (
        message.tick >= value.tick &&
        !active.has(id) &&
        !this.tombstones.has(id)
      )
        this.tombstones.set(id, message.tick);
    for (const [id, value] of this.eventProjectiles)
      if (message.tick - value.tick > LIMITS.snapshots * 3)
        this.eventProjectiles.delete(id);
    for (const [id, tick] of this.tombstones)
      if (message.tick - tick > LIMITS.snapshots * 3)
        this.tombstones.delete(id);
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
      this.pendingEvents++;
      if (this.pendingEvents > 256) return false;
      this.consume(event, batch.tick, localId);
    }
    return true;
  }

  private consume(event: CombatEvent, tick: number, localId: string) {
    if (event.type === "death" || event.type === "respawn") {
      if (event.type === "death") {
        this.deaths++;
        if (event.player.id === localId) this.localDeaths++;
      } else {
        this.respawns++;
        if (event.player.id === localId) this.localRespawns++;
      }
      this.note(
        tick,
        event.type + " " + event.player.id + " life " + event.player.lifeId,
      );
      return;
    }
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
          startsTick: tick,
          immediate: false,
          expiresTick: tick + CARBINE.muzzleFlashTicks,
        });
      }
      this.eventProjectiles.set(event.projectileId, {
        tick,
        projectile: {
          id: event.projectileId,
          ownerId: event.ownerId,
          ownerLifeId: event.ownerLifeId,
          ownerSlot: event.ownerSlot,
          x: event.x,
          y: event.y,
          aimQ: event.aimQ,
        },
      });
      this.note(
        tick,
        (event.ownerId === localId ? "local" : "remote") +
          " shot " +
          event.projectileId,
      );
      return;
    }
    this.tombstones.set(event.projectileId, tick);
    if (event.target === "player") {
      this.playerImpacts++;
      this.damage += event.damage;
      if (event.damage === 0) this.protectedHits++;
    } else this.terrainImpacts++;
    this.addEffect({
      kind:
        event.target === "player"
          ? event.damage === 0
            ? "impact-protected"
            : "impact-player"
          : "impact-terrain",
      x: event.x,
      y: event.y,
      normalX: event.normalX,
      normalY: event.normalY,
      ownerSlot: 1,
      startsTick: tick,
      immediate: false,
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
      ownerId: player.id,
      ownerLifeId: player.lifeId,
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
      startsTick: sourceTick,
      immediate: true,
      expiresTick: sourceTick + CARBINE.muzzleFlashTicks,
    });
  }

  presentation(
    authoritative: ProjectileView[],
    renderTick: number,
    localTick = renderTick,
  ) {
    this.effects = this.effects.filter(
      (effect) =>
        effect.expiresTick > (effect.immediate ? localTick : renderTick),
    );
    const byId = new Map<number, ProjectileView>();
    for (const projectile of authoritative)
      if ((this.tombstones.get(projectile.id) ?? Infinity) > renderTick)
        byId.set(projectile.id, projectile);
    for (const [id, value] of this.eventProjectiles)
      if (
        value.tick <= renderTick &&
        !byId.has(id) &&
        (this.tombstones.get(id) ?? Infinity) > renderTick
      )
        byId.set(id, value.projectile);
    for (const projectile of this.provisionals.values())
      byId.set(projectile.id, projectile);
    return {
      projectiles: [...byId.values()].slice(
        0,
        CARBINE.roomProjectileCap + CARBINE.provisionalProjectileCap,
      ),
      effects: this.effects.filter(
        (effect) =>
          (effect.immediate ? localTick : renderTick) >= effect.startsTick,
      ),
    };
  }

  clear() {
    this.roomGeneration = 0;
    this.eventCursor = 0;
    this.provisionals.clear();
    this.eventProjectiles.clear();
    this.tombstones.clear();
    this.effects = [];
    this.pendingEvents = 0;
  }
  clearLocal() {
    this.provisionals.clear();
    this.effects = this.effects.filter((effect) => !effect.immediate);
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
      damage: this.damage,
      protectedHits: this.protectedHits,
      deaths: this.deaths,
      respawns: this.respawns,
      localDeaths: this.localDeaths,
      localRespawns: this.localRespawns,
      pendingEvents: this.pendingEvents,
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
