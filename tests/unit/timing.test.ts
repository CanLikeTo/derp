import { expect, test } from "bun:test";
import { timingScenario } from "../fixtures/timing";
import {
  TimingLog,
  predictionLead,
  ServerClock,
  SchedulingJitter,
} from "../../apps/client/src/timing";
import { Room } from "../../apps/server/src/room";
import { initializePhysics, NEUTRAL } from "@derp/simulation";

test("diagnostics stay bounded and attribute receipt outcomes to each player", async () => {
  await initializePhysics();
  const room = new Room();
  try {
    const a = room.join("a")!,
      b = room.join("b")!;
    room.baseline("a");
    room.baseline("b");
    const input = {
      type: "input" as const,
      inputEpoch: a.epoch,
      tick: 1,
      ...NEUTRAL,
    };
    room.input("a", input, 10);
    for (let i = 0; i < 100; i++) room.input("a", input, 11 + i);
    expect(room.tick).toBe(0);
    room.step();
    room.input("a", input, 200);
    expect(a.timing.accepted).toBe(1);
    expect(a.timing.duplicate).toBe(100);
    expect(a.timing.late).toBe(1);
    expect(a.timing.receipts).toHaveLength(6);
    expect(a.timing.receipts.at(-1)).toMatchObject({
      tick: 1,
      receivedTick: 1,
      receivedAt: 200,
      outcome: "late",
    });
    expect(b.timing.late).toBe(0);
    expect(b.timing.missing).toBe(1);
  } finally {
    room.dispose();
  }
  const log = new TimingLog();
  for (let i = 0; i < 3000; i++) log.add({ tick: i });
  expect(log.records).toHaveLength(2400);
  expect(log.records[0]!.sequence).toBe(601);
  expect(predictionLead(0, 0)).toBe(2);
  expect(predictionLead(10000, 1000)).toBe(12);
});

test("measured scheduling jitter bounds repeated short stalls without changing server deadlines", async () => {
  const fixed = await timingScenario({
    adapt: true,
    mapClock: true,
    repeatedStalls: true,
  });
  const measured = await timingScenario({
    adapt: true,
    mapClock: true,
    repeatedStalls: true,
    schedulingMargin: true,
  });
  expect(fixed.lateAfterSettling).toBeGreaterThan(0);
  expect(measured.lateAfterSettling).toBeLessThan(fixed.lateAfterSettling);
  expect(measured.lateAfterSettling).toBe(0);
  expect(measured.corrections.p95).toBeLessThan(0.08);
  expect(measured.lead).toBeLessThanOrEqual(12);
  expect(measured.pending).toBeLessThanOrEqual(120);
  const jitter = new SchedulingJitter();
  jitter.observe(1000);
  expect(jitter.allowance).toBe(250);
  for (let i = 0; i < 120; i++) jitter.observe(3);
  expect(jitter.allowance).toBe(3);
  jitter.clear();
  expect(jitter.allowance).toBe(0);
});

test("regression: baseline-only lead misses deadlines when latency grows", async () => {
  const frozen = await timingScenario({
    adapt: false,
    increase: true,
    phase: 16,
  });
  expect(frozen.lateAfterSettling).toBeGreaterThan(500);
  expect(frozen.corrections.p95).toBeGreaterThan(0.08);
  expect(
    frozen.records.some(
      (r) =>
        r.outcome === "late" &&
        (r.receivedTick as number) >= (r.tick as number),
    ),
  ).toBe(true);
});

test("regression control: a delayed baseline leaves clock bias despite later lead updates", async () => {
  const result = await timingScenario({
    adapt: true,
    baselineDelay: 50,
    phase: 16,
  });
  expect(result.lateAfterSettling).toBeGreaterThan(100);
  expect(result.corrections.p95).toBeGreaterThan(0.08);
});

test("updating lead meets the same changing-delay deadlines without changing physics time", async () => {
  for (const phase of [0, 8, 16]) {
    const result = await timingScenario({
      adapt: true,
      mapClock: true,
      increase: true,
      phase,
    });
    expect(result.lateAfterSettling).toBe(0);
    expect(result.corrections.p95).toBeLessThan(0.08);
    expect(result.lead).toBeLessThanOrEqual(12);
    expect(result.pending).toBeLessThanOrEqual(120);
  }
});

test("short stalls retire expired intent and long stalls establish a fresh epoch", async () => {
  for (const stallMs of [40, 180, 1000]) {
    const result = await timingScenario({
      adapt: true,
      mapClock: true,
      stallMs,
    });
    expect(result.resyncs).toBe(stallMs > 250 ? 1 : 0);
    expect(result.pending).toBeLessThanOrEqual(120);
    expect(result.queued).toBeLessThan(256);
    expect(result.lateAfterSettling).toBeLessThan(60);
  }
});

test("timestamp mapping repairs delayed baselines with the unchanged lead formula", async () => {
  for (const baselineDelay of [0, 50, 150]) {
    for (const phase of [0, 8, 16]) {
      const result = await timingScenario({
        adapt: true,
        mapClock: true,
        baselineDelay,
        phase,
      });
      expect(result.lateAfterSettling).toBe(0);
      expect(result.corrections.p95).toBeLessThan(0.08);
      expect(result.lead).toBeLessThanOrEqual(12);
    }
  }
});

test("clock corrections never reverse or stop time and a new baseline can rebase overruns", () => {
  const clock = new ServerClock();
  clock.observe(10050, 0, 100);
  expect(clock.baseline(60, 10000, 150)).toBeCloseTo(69);
  let previous = clock.tick(150);
  for (let n = 1; n <= 100; n++) {
    const now = 150 + n * 16;
    clock.observe(now + 9800, now - 10, now);
    const next = clock.tick(now);
    expect(next - previous).toBeGreaterThanOrEqual(
      (16 / (1000 / 60)) * 0.9 - 1e-9,
    );
    expect(next - previous).toBeLessThanOrEqual(
      (16 / (1000 / 60)) * 1.1 + 1e-9,
    );
    previous = next;
  }
  expect(clock.baseline(70, 20000, 1800)).toBe(70);
  clock.clear();
  clock.observe(50, 0, 100);
  expect(clock.baseline(0, 0, 100)).toBeCloseTo(6);
});
