import { TICK_MS, initializePhysics } from "@derp/simulation";
import { emptyInputTiming, type StateMessage } from "@derp/protocol";
import { Room } from "../../apps/server/src/room";
import { Prediction } from "../../apps/client/src/prediction";
import {
  predictionLead,
  SchedulingJitter,
  ServerClock,
} from "../../apps/client/src/timing";

// A virtual monotonic clock drives the real room and prediction independently.
// Ordered, seeded application delays are not TCP packet loss. The frozen branch
// preserves the shipped baseline-only lead as a regression control.
export async function timingScenario(options: {
  adapt: boolean;
  mapClock?: boolean;
  phase?: number;
  stallMs?: number;
  increase?: boolean;
  baselineDelay?: number;
  repeatedStalls?: boolean;
  schedulingMargin?: boolean;
}) {
  await initializePhysics();
  const room = new Room(),
    prediction = new Prediction();
  const peer = room.join("timing-player")!;
  room.baseline(peer.state.id);
  for (let i = 0; i < 60; i++) room.step();
  const stats = {
    tickP95: 0,
    tickP99: 0,
    scheduleMs: 0,
    overruns: 0,
    lateInputs: 0,
    connections: 1,
    queuedInputs: 0,
    rssMB: 0,
    inBytes: 0,
    outBytes: 0,
  };
  const state = (type: "baseline" | "snapshot"): StateMessage => ({
    rules: { jetsEnabled: false },
    type,
    tick: room.tick,
    serverTime: now + origin,
    playerId: peer.state.id,
    inputEpoch: peer.epoch,
    players: room.snapshot(),
    stats,
    inputTiming: { ...emptyInputTiming(), ...peer.timing },
    reason: "virtual clock",
  });
  let now = 0,
    seed = 731,
    outgoingDue = 0,
    incomingDue = 0;
  let lead = predictionLead(100, 10),
    anchorTick = room.tick,
    anchorAt = 0;
  const clock = new ServerClock();
  const scheduling = new SchedulingJitter();
  let rtt = 100;
  const desiredLead = () =>
    predictionLead(
      rtt,
      10 + (options.schedulingMargin ? scheduling.allowance : 0),
    );
  // Completed calibration with deliberately different process clock origins.
  const origin = 123456;
  clock.observe(origin + 50, 0, 100);
  const estimatedTick = () =>
    options.mapClock
      ? clock.tick(now)
      : anchorTick + (now - anchorAt) / TICK_MS;
  let initialized = false,
    nextFrame = options.phase ?? 0,
    previousFrame = 0,
    resyncs = 0;
  const pending: { due: number; run: () => void }[] = [];
  const records: Record<string, string | number>[] = [];
  function enqueue(direction: "up" | "down", run: () => void, extraDelay = 0) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const delay =
      (options.increase && now >= 5000 ? 100 : 50) +
      ((seed / 2 ** 32) * 2 - 1) * 10;
    const due = Math.max(
      now + delay + extraDelay,
      direction === "up" ? outgoingDue : incomingDue,
    );
    if (direction === "up") outgoingDue = due;
    else incomingDue = due;
    pending.push({ due, run });
  }
  function baseline() {
    const message = state("baseline");
    enqueue(
      "down",
      () => {
        anchorTick = message.tick;
        anchorAt = now - (options.increase && now >= 5000 ? 100 : 50);
        if (options.mapClock)
          clock.baseline(message.tick, message.serverTime, now);
        prediction.baseline(message, Math.floor(estimatedTick()) + lead);
        initialized = true;
      },
      options.baselineDelay ?? 0,
    );
  }
  baseline();
  try {
    for (now = 0; now < 20000; now++) {
      while (room.tick < 60 + Math.floor(now / TICK_MS)) {
        room.step();
        if (room.tick % 3 === 0) {
          const message = state("snapshot");
          enqueue("down", () => {
            if (initialized) prediction.reconcile(message);
          });
        }
      }
      const stalled =
        (!!options.stallMs && now >= 10000 && now < 10000 + options.stallMs) ||
        (!!options.repeatedStalls && now >= 5000 && now % 300 < 70);
      if (!stalled) {
        pending.sort((a, b) => a.due - b.due);
        while (pending[0] && pending[0].due <= now) {
          const entry = pending.shift()!;
          scheduling.observe(now - entry.due);
          if (options.adapt) lead = Math.max(lead, desiredLead());
          entry.run();
        }
      }
      if (now % 1000 === 0) {
        const sent = now;
        enqueue("up", () => {
          const serverTime = now + origin;
          enqueue("down", () => {
            if (options.mapClock) clock.observe(serverTime, sent, now);
            rtt = now - sent;
            if (options.adapt) lead = Math.max(lead, desiredLead());
          });
        });
      }
      if (now >= nextFrame && !stalled) {
        const elapsed = now - previousFrame;
        previousFrame = now;
        nextFrame = now + TICK_MS;
        if (elapsed > 250 && initialized) {
          initialized = false;
          resyncs++;
          prediction.cancelPending();
          room.suspend(peer.state.id);
          room.baseline(peer.state.id);
          baseline();
        }
        if (initialized) {
          const target = Math.floor(estimatedTick()) + lead;
          for (let i = 0; i < 5 && prediction.tick < target; i++) {
            const frame = prediction.advance({
              jetHeld: false,
              moveX: Math.floor(now / 1000) % 2 ? -1 : 1,
              jumpPressed: false,
            });
            const generatedAt = now;
            enqueue("up", () => {
              room.input(peer.state.id, frame, now);
              records.push({
                tick: frame.tick,
                inputEpoch: frame.inputEpoch,
                generatedAt,
                receivedAt: now,
                receivedTick: room.tick,
                lead,
                outcome: peer.timing.receipts.at(-1)?.outcome ?? "obsolete",
              });
            });
          }
        }
      }
    }
    return {
      late: peer.timing.late,
      corrections: prediction.corrections.summary(),
      resyncs,
      pending: prediction.history.size,
      queued: pending.length,
      lead,
      lateAfterSettling: records.filter(
        (r) => (r.generatedAt as number) > 7000 && r.outcome === "late",
      ).length,
      records,
      correctionRecords: prediction.timing.records,
    };
  } finally {
    room.dispose();
    prediction.dispose();
  }
}
