import {
  Simulation,
  neutralInput,
  shortestAimDelta,
  interpolateAimQ,
  CONTENT_VERSION,
  TRACE_VERSION,
  type RoomRules,
  type PlayerState,
  type Input,
  type Trace,
} from "@derp/simulation";
import {
  LIMITS,
  Samples,
  type InputFrame,
  type ProjectileView,
  type StateMessage,
  type CombatEvent,
} from "@derp/protocol";
import { TimingLog } from "./timing";

export type ConfirmedShieldBreak = { lifeId: number; eventId: number };

// Shield feedback follows the latest confirmed state, including a shot event
// that arrived before the next replaceable snapshot. Prediction may run ahead.
export function confirmedLocalProtectionUntil(
  predicted: PlayerState,
  confirmed: PlayerState | undefined,
  snapshotCursor: number,
  shieldBreak: ConfirmedShieldBreak | undefined,
): number {
  if (!confirmed || predicted.lifeId !== confirmed.lifeId) return 0;
  if (
    shieldBreak?.lifeId === confirmed.lifeId &&
    shieldBreak.eventId > snapshotCursor
  )
    return 0;
  return confirmed.spawnProtectedUntilTick;
}

export class Prediction {
  timing = new TimingLog();
  rules: RoomRules = { jetsEnabled: false };
  ordinaryCorrections = new Samples();
  thrustCorrections = new Samples();
  aimCorrections = new Samples();
  private simulation = new Simulation();
  state: PlayerState | undefined;
  authoritative: PlayerState | undefined;
  tick = 0;
  finalizedTick = 0;
  epoch = 0;
  history = new Map<number, { input: InputFrame; state: PlayerState }>();
  corrections = new Samples();
  correction = 0;
  aimCorrection = 0;
  offset = { x: 0, y: 0 };
  baseline(message: StateMessage, target: number) {
    const local = message.players.find(
      (player) => player.id === message.playerId,
    )!;
    this.rules = { ...message.rules };
    this.state = { ...local };
    this.authoritative = { ...local };
    this.tick = message.tick;
    this.finalizedTick = message.tick;
    this.epoch = message.inputEpoch;
    this.history.clear();
    this.offset = { x: 0, y: 0 };
    this.aimCorrection = 0;
    // Seed the prediction lead with neutral ticks; these are also neutral on the server.
    while (
      this.state.health > 0 &&
      this.tick < target &&
      this.history.size < LIMITS.history
    )
      this.advance(neutralInput(this.state!.aimQ));
  }
  advance(input: Input): InputFrame {
    return this.advanceWithActions(input).frame;
  }
  advanceWithActions(input: Input): {
    frame: InputFrame;
    shotAuthorized: boolean;
  } {
    if (!this.state) throw new Error("Prediction needs a baseline");
    if (this.history.size >= LIMITS.history)
      throw new Error("Prediction history exhausted");
    const frame: InputFrame = {
      type: "input",
      inputEpoch: this.epoch,
      lifeId: this.state.lifeId,
      tick: ++this.tick,
      ...input,
    };
    const result = this.simulation.stepWithActions(
      this.state,
      frame,
      this.rules,
    );
    this.state = result.state;
    this.history.set(this.tick, { input: frame, state: { ...this.state } });
    return { frame, shotAuthorized: result.shotAuthorized };
  }
  reconcile(message: StateMessage) {
    if (
      message.inputEpoch !== this.epoch ||
      message.tick <= this.finalizedTick ||
      !this.state
    )
      return;
    if (message.rules.jetsEnabled !== this.rules.jetsEnabled)
      throw new Error("Room rules require a new baseline");
    const authoritative = message.players.find(
      (player) => player.id === message.playerId,
    )!;
    const sameTick = this.history.get(message.tick)?.state;
    if (sameTick) {
      this.correction = Math.hypot(
        sameTick.x - authoritative.x,
        sameTick.y - authoritative.y,
      );
      this.corrections.add(this.correction);
      this.aimCorrection = Math.abs(
        shortestAimDelta(sameTick.aimQ, authoritative.aimQ),
      );
      this.aimCorrections.add(this.aimCorrection);
      (sameTick.jetActive || authoritative.jetActive
        ? this.thrustCorrections
        : this.ordinaryCorrections
      ).add(this.correction);
      this.timing.add({
        stage: "correction",
        playerId: message.playerId,
        inputEpoch: message.inputEpoch,
        tick: message.tick,
        at: performance.now(),
        magnitude: this.correction,
        aimMagnitude: this.aimCorrection,
      });
    }
    const old = this.state;
    this.authoritative = { ...authoritative };
    this.finalizedTick = message.tick;
    this.state = { ...authoritative };
    for (const tick of this.history.keys())
      if (tick <= message.tick) this.history.delete(tick);
    const target = Math.max(message.tick, this.tick);
    for (let tick = message.tick + 1; tick <= target; tick++) {
      const entry = this.history.get(tick);
      if (!entry) throw new Error("Prediction timeline has a gap");
      this.state = this.simulation.step(this.state, entry.input, this.rules);
      entry.state = { ...this.state };
    }
    this.tick = target;
    if (
      old.lifeId !== this.state.lifeId ||
      old.health === 0 ||
      this.state.health === 0
    ) {
      this.offset = { x: 0, y: 0 };
      return;
    }
    const delta = {
      x: old.x + this.offset.x - this.state.x,
      y: old.y + this.offset.y - this.state.y,
    };
    this.offset = Math.hypot(delta.x, delta.y) < 0.2 ? delta : { x: 0, y: 0 };
  }
  smooth(dt: number) {
    const decay = Math.exp(-dt / 35);
    this.offset.x *= decay;
    this.offset.y *= decay;
  }
  trace(): Trace | undefined {
    if (!this.authoritative) return;
    return {
      version: TRACE_VERSION,
      contentVersion: CONTENT_VERSION,
      initial: { ...this.authoritative },
      rules: { ...this.rules },
      inputs: [...this.history.values()].map((entry) => ({
        moveX: entry.input.moveX,
        jumpPressed: entry.input.jumpPressed,
        jetHeld: entry.input.jetHeld,
        aimQ: entry.input.aimQ,
        fire: entry.input.fire,
      })),
    };
  }
  cancelPending() {
    this.history.clear();
    this.offset = { x: 0, y: 0 };
    this.tick = this.finalizedTick;
    if (this.authoritative)
      this.state = {
        ...this.authoritative,
        jumpBufferTicksRemaining: 0,
        jetActive: false,
      };
  }
  clear() {
    this.state = undefined;
    this.authoritative = undefined;
    this.history.clear();
    this.offset = { x: 0, y: 0 };
  }
  dispose() {
    this.simulation.dispose();
  }
}
export class Interpolation {
  snapshots: StateMessage[] = [];
  lifecycle: Array<{ tick: number; event: CombatEvent }> = [];
  underruns = 0;
  clear() {
    this.snapshots = [];
    this.lifecycle = [];
  }
  record(event: CombatEvent, tick: number) {
    if (this.lifecycle.length >= 120)
      throw new Error("Lifecycle history exhausted");
    this.lifecycle.push({ event, tick });
  }
  push(message: StateMessage) {
    if (this.snapshots.at(-1)?.tick === message.tick) {
      this.snapshots[this.snapshots.length - 1] = message;
      return;
    }
    if ((this.snapshots.at(-1)?.tick ?? -1) > message.tick) return;
    this.snapshots.push(message);
    if (this.snapshots.length > LIMITS.snapshots) this.snapshots.shift();
    const oldest = this.snapshots[0]?.tick ?? 0;
    this.lifecycle = this.lifecycle.filter((entry) => entry.tick >= oldest);
  }
  at(tick: number, localId: string): PlayerState[] {
    const latest = this.snapshots.at(-1);
    if (!latest) return [];
    let before = this.snapshots[0]!,
      after = latest;
    if (tick > latest.tick) this.underruns++;
    for (const frame of this.snapshots) {
      if (frame.tick <= tick) before = frame;
      if (frame.tick >= tick) {
        after = frame;
        break;
      }
    }
    const t =
      after.tick === before.tick
        ? 0
        : Math.min(
            1,
            Math.max(0, (tick - before.tick) / (after.tick - before.tick)),
          );
    return latest.players
      .filter((player) => player.id !== localId)
      .map((player) => {
        const a = before.players.find((p) => p.id === player.id) ?? player;
        const b = after.players.find((p) => p.id === player.id) ?? a;
        const transitions = this.lifecycle.filter(
          (entry) =>
            entry.tick > before.tick &&
            entry.tick <= after.tick &&
            (entry.event.type === "death" || entry.event.type === "respawn") &&
            entry.event.player.id === player.id,
        );
        const past = transitions.filter((entry) => entry.tick <= tick).at(-1);
        let pose: PlayerState;
        if (past) {
          const life =
            past.event.type === "death" || past.event.type === "respawn"
              ? past.event.player
              : a;
          if (
            life.health === 0 ||
            life.lifeId !== b.lifeId ||
            after.tick === past.tick
          )
            pose = { ...life };
          else {
            const factor = Math.min(
              1,
              Math.max(0, (tick - past.tick) / (after.tick - past.tick)),
            );
            pose = {
              ...life,
              x: life.x + (b.x - life.x) * factor,
              y: life.y + (b.y - life.y) * factor,
              aimQ: interpolateAimQ(life.aimQ, b.aimQ, factor),
            };
          }
        } else {
          const first = transitions[0];
          const finish =
            first &&
            (first.event.type === "death" || first.event.type === "respawn")
              ? first.event.player
              : b;
          const factor = first
            ? Math.min(
                1,
                Math.max(0, (tick - before.tick) / (first.tick - before.tick)),
              )
            : t;
          pose =
            a.lifeId !== finish.lifeId
              ? { ...a }
              : {
                  ...a,
                  x: a.x + (finish.x - a.x) * factor,
                  y: a.y + (finish.y - a.y) * factor,
                  aimQ: interpolateAimQ(a.aimQ, finish.aimQ, factor),
                };
        }
        const healthEvent = this.lifecycle
          .filter(
            (entry) =>
              entry.tick <= tick &&
              entry.event.type === "impact" &&
              entry.event.target === "player" &&
              entry.event.targetId === player.id &&
              entry.event.targetLifeId === pose.lifeId,
          )
          .at(-1);
        if (
          healthEvent?.event.type === "impact" &&
          healthEvent.event.target === "player"
        )
          pose.health = Math.min(pose.health, healthEvent.event.health);
        return pose;
      });
  }
  projectilesAt(tick: number): ProjectileView[] {
    const latest = this.snapshots.at(-1);
    if (!latest) return [];
    let before = this.snapshots[0]!;
    let after = latest;
    for (const frame of this.snapshots) {
      if (frame.tick <= tick) before = frame;
      if (frame.tick >= tick) {
        after = frame;
        break;
      }
    }
    const t =
      after.tick === before.tick
        ? 0
        : Math.min(
            1,
            Math.max(0, (tick - before.tick) / (after.tick - before.tick)),
          );
    return before.projectiles
      .flatMap((a) => {
        const b = after.projectiles.find((candidate) => candidate.id === a.id);
        return [
          {
            ...a,
            x: b ? a.x + (b.x - a.x) * t : a.x,
            y: b ? a.y + (b.y - a.y) * t : a.y,
            aimQ: b ? interpolateAimQ(a.aimQ, b.aimQ, t) : a.aimQ,
          },
        ];
      })
      .concat(
        tick >= after.tick
          ? after.projectiles.filter(
              (candidate) =>
                !before.projectiles.some((old) => old.id === candidate.id),
            )
          : [],
      );
  }
}
