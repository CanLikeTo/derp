import { fixtureTrace } from "@derp/simulation";
import { expect, test } from "bun:test";
import {
  parseClient,
  parseServer,
  CONTENT_VERSION,
  PROTOCOL_VERSION,
  validPlayer,
  parseTrace,
  emptyInputTiming,
} from "@derp/protocol";
import { Outbox } from "../../apps/server/src/server";
test("runtime validation rejects extra authority, wrong types, and bounds", () => {
  expect(
    parseClient(
      JSON.stringify({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        content: CONTENT_VERSION,
      }),
    ).type,
  ).toBe("hello");
  const input = {
    jetHeld: false,
    type: "input",
    inputEpoch: 1,
    tick: 1,
    moveX: 1,
    jumpPressed: false,
  };
  for (const value of [
    { ...input, x: 42 },
    { ...input, moveX: 2 },
    { ...input, tick: -1 },
    { ...input, tick: 1.5 },
    { ...input, jumpPressed: 1 },
    { ...input, inputEpoch: null },
  ])
    expect(() => parseClient(JSON.stringify(value))).toThrow();
  expect(() => parseClient(" ".repeat(2049))).toThrow();
  expect(() => parseClient("{")).toThrow();
  expect(() => parseServer('{"type":"snapshot"}')).toThrow();
});

test("recipient timing payloads require bounded, typed receipts", () => {
  const baseline = {
    rules: { jetsEnabled: false },
    type: "baseline" as const,
    tick: 0,
    serverTime: 0,
    playerId: "fixture",
    inputEpoch: 1,
    players: [fixtureTrace().initial],
    reason: "test",
    inputTiming: emptyInputTiming(),
    stats: {
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
    },
  };
  expect(parseServer(JSON.stringify(baseline))).toEqual(baseline);
  const receipt = {
    inputEpoch: 1,
    tick: 10,
    receivedTick: 9,
    receivedAt: 123,
    outcome: "accepted",
  };
  for (const invalid of [
    undefined,
    { ...emptyInputTiming(), late: -1 },
    { ...emptyInputTiming(), accepted: 0.5 },
    { ...emptyInputTiming(), receipts: Array(7).fill(receipt) },
    { ...emptyInputTiming(), receipts: [{ ...receipt, outcome: "maybe" }] },
    { ...emptyInputTiming(), receipts: [{ ...receipt, receivedTick: "9" }] },
    { ...emptyInputTiming(), receipts: [{ ...receipt, unexpected: true }] },
  ])
    expect(() =>
      parseServer(JSON.stringify({ ...baseline, inputTiming: invalid })),
    ).toThrow();
});
test("slow output retains only latest snapshot and closes after deadline", () => {
  let buffered = 20000,
    closed = false;
  const sent: string[] = [];
  const socket = {
    getBufferedAmount: () => buffered,
    send: (raw: string | ArrayBuffer | Uint8Array) => {
      sent.push(String(raw));
      return String(raw).length;
    },
    close: () => {
      closed = true;
    },
  };
  const box = new Outbox();
  box.offer("old", true, socket as never, 0);
  box.offer("new", true, socket as never, 1000);
  expect(box.pending).toBe("new");
  expect(sent).toEqual([]);
  box.offer("newest", true, socket as never, 2001);
  expect(closed).toBe(true);
  const fresh = new Outbox();
  buffered = 0;
  fresh.offer("baseline", false, socket as never, 0);
  expect(sent).toEqual(["baseline"]);
});

test("versioned replay and player counters fail closed", () => {
  const trace = fixtureTrace();
  expect(parseTrace(trace)).toEqual(trace);
  for (const field of ["coyoteTicksRemaining", "jumpBufferTicksRemaining"]) {
    for (const bad of [undefined, -1, 7, 0.5, null, "1"]) {
      const state = { ...trace.initial, [field]: bad };
      if (bad === undefined) Reflect.deleteProperty(state, field);
      expect(validPlayer(state)).toBe(false);
      expect(() => parseTrace({ ...trace, initial: state })).toThrow(
        "incompatible trace",
      );
    }
  }
  for (const value of [
    null,
    { ...trace, version: 1 },
    { ...trace, contentVersion: "playground-1" },
    {
      ...trace,
      inputs: [{ jetHeld: false, moveX: 0, jumpPressed: true, elapsed: 100 }],
    },
  ])
    expect(() => parseTrace(value)).toThrow("incompatible trace");
});
