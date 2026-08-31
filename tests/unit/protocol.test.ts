import { expect, test } from "bun:test";
import { parseClient, parseServer, CONTENT_VERSION } from "@derp/protocol";
import { Outbox } from "../../apps/server/src/server";
test("runtime validation rejects extra authority, wrong types, and bounds", () => {
  expect(
    parseClient(
      JSON.stringify({ type: "hello", protocol: 1, content: CONTENT_VERSION }),
    ).type,
  ).toBe("hello");
  const input = {
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
