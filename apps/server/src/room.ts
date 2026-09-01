import {
  Simulation,
  spawnState,
  neutralInput,
  type RoomRules,
  type PlayerState,
} from "@derp/simulation";
import {
  LIMITS,
  emptyInputTiming,
  type InputTiming,
  type InputFrame,
} from "@derp/protocol";
export type Participant = {
  state: PlayerState;
  epoch: number;
  active: boolean;
  inputs: Map<number, InputFrame>;
  timing: InputTiming;
};
export class Room {
  rules: RoomRules = { jetsEnabled: false };
  tick = 0;
  lateInputs = 0;
  private nextEpoch = 1;
  private simulation = new Simulation();
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
  step() {
    this.tick++;
    for (const peer of this.participants.values()) {
      const input = peer.active ? peer.inputs.get(this.tick) : undefined;
      if (peer.active && !input) peer.timing.missing++;
      peer.state = this.simulation.step(
        peer.state,
        input ?? neutralInput(peer.state.aimQ),
        this.rules,
      );
      peer.inputs.delete(this.tick);
    }
  }
  reset() {
    for (const peer of this.participants.values())
      peer.state = spawnState(peer.state.id, peer.state.slot);
  }
  snapshot() {
    return [...this.participants.values()].map((peer) => ({ ...peer.state }));
  }
  dispose() {
    this.simulation.dispose();
  }
}
