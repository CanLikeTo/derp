import {
  Simulation,
  NEUTRAL,
  CONTENT_VERSION,
  TRACE_VERSION,
  type PlayerState,
  type Input,
  type Trace,
} from "@derp/simulation";
import {
  LIMITS,
  Samples,
  type InputFrame,
  type StateMessage,
} from "@derp/protocol";
export class Prediction {
  private simulation = new Simulation();
  state: PlayerState | undefined;
  authoritative: PlayerState | undefined;
  tick = 0;
  finalizedTick = 0;
  epoch = 0;
  history = new Map<number, { input: InputFrame; state: PlayerState }>();
  corrections = new Samples();
  correction = 0;
  offset = { x: 0, y: 0 };
  baseline(message: StateMessage, target: number) {
    const local = message.players.find(
      (player) => player.id === message.playerId,
    )!;
    this.state = { ...local };
    this.authoritative = { ...local };
    this.tick = message.tick;
    this.finalizedTick = message.tick;
    this.epoch = message.inputEpoch;
    this.history.clear();
    this.offset = { x: 0, y: 0 };
    // Seed the prediction lead with neutral ticks; these are also neutral on the server.
    while (this.tick < target && this.history.size < LIMITS.history)
      this.advance(NEUTRAL);
  }
  advance(input: Input): InputFrame {
    if (!this.state) throw new Error("Prediction needs a baseline");
    if (this.history.size >= LIMITS.history)
      throw new Error("Prediction history exhausted");
    const frame: InputFrame = {
      type: "input",
      inputEpoch: this.epoch,
      tick: ++this.tick,
      ...input,
    };
    this.state = this.simulation.step(this.state, frame);
    this.history.set(this.tick, { input: frame, state: { ...this.state } });
    return frame;
  }
  reconcile(message: StateMessage) {
    if (
      message.inputEpoch !== this.epoch ||
      message.tick <= this.finalizedTick ||
      !this.state
    )
      return;
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
      this.state = this.simulation.step(this.state, entry.input);
      entry.state = { ...this.state };
    }
    this.tick = target;
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
      inputs: [...this.history.values()].map((entry) => ({
        moveX: entry.input.moveX,
        jumpPressed: entry.input.jumpPressed,
      })),
    };
  }
  cancelPending() {
    this.history.clear();
    this.offset = { x: 0, y: 0 };
    this.tick = this.finalizedTick;
    if (this.authoritative)
      this.state = { ...this.authoritative, jumpBufferTicksRemaining: 0 };
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
  underruns = 0;
  clear() {
    this.snapshots = [];
  }
  push(message: StateMessage) {
    if (this.snapshots.at(-1)?.tick === message.tick) return;
    this.snapshots.push(message);
    if (this.snapshots.length > LIMITS.snapshots) this.snapshots.shift();
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
        return {
          ...player,
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
      });
  }
}
