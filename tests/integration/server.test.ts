import { afterAll, beforeAll, expect, test } from "bun:test";
import { startServer } from "../../apps/server/src/server";
import {
  CONTENT_VERSION,
  PROTOCOL_VERSION,
  parseServer,
  type ServerMessage,
} from "@derp/protocol";
let running: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  running = await startServer(0);
});
afterAll(() => running.stop());
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(
  hello: unknown = {
    type: "hello",
    protocol: PROTOCOL_VERSION,
    content: CONTENT_VERSION,
  },
) {
  // DOM's constructor typing hides Bun's documented custom-header overload.
  const Socket = WebSocket as unknown as new (
    url: string,
    options: Bun.WebSocketOptions,
  ) => WebSocket;
  const socket = new Socket(`ws://127.0.0.1:${running.server.port}/ws`, {
    headers: { Origin: "http://127.0.0.1:5173" },
  });
  const messages: ServerMessage[] = [];
  socket.addEventListener("message", (event) =>
    messages.push(parseServer(String(event.data))),
  );
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(JSON.stringify(hello));
  for (let i = 0; i < 100 && !messages.length; i++) await delay(10);
  return { socket, messages };
}
test("loopback admission, third rejection, cleanup, versions and malformed messages", async () => {
  const a = await connect(),
    b = await connect(),
    c = await connect();
  expect(a.messages[0]?.type).toBe("baseline");
  expect(b.messages[0]?.type).toBe("baseline");
  expect(c.messages[0]).toEqual({
    type: "rejected",
    reason: "Room full (two players)",
  });
  a.socket.close();
  b.socket.close();
  c.socket.close();
  await delay(50);
  expect(running.room.participants.size).toBe(0);
  const bad = await connect({
    type: "hello",
    protocol: 999,
    content: CONTENT_VERSION,
  });
  expect(bad.messages[0]?.type).toBe("rejected");
  bad.socket.close();
  const d = await connect();
  d.socket.send("{");
  await delay(50);
  expect(d.messages.some((m) => m.type === "rejected")).toBe(true);
  d.socket.close();
  const url = `http://127.0.0.1:${running.server.port}/ws`;
  expect(
    (await fetch(url, { headers: { Origin: "https://evil.example" } })).status,
  ).toBe(403);
  expect((await fetch(url)).status).toBe(403);
  expect(
    (
      await fetch(url, {
        headers: { Host: "evil.example", Origin: "http://127.0.0.1:5173" },
      })
    ).status,
  ).toBe(403);
});
test("live reset replaces epochs, stale input ignored, flood rejected", async () => {
  await delay(50);
  const a = await connect();
  const baseline = a.messages[0];
  if (baseline?.type !== "baseline") throw new Error("No baseline");
  a.socket.send(
    JSON.stringify({ type: "reset", inputEpoch: baseline.inputEpoch }),
  );
  await delay(80);
  const reset = a.messages.find(
    (m) => m.type === "baseline" && m.reason === "room reset",
  );
  expect(reset?.type).toBe("baseline");
  if (reset?.type !== "baseline") throw new Error("No reset");
  expect(reset.inputEpoch).not.toBe(baseline.inputEpoch);
  a.socket.send(
    JSON.stringify({
      type: "input",
      inputEpoch: baseline.inputEpoch,
      tick: reset.tick + 16,
      moveX: 1,
      jumpPressed: true,
    }),
  );
  for (let i = 0; i < 180; i++) {
    if (a.socket.readyState === WebSocket.OPEN)
      a.socket.send(JSON.stringify({ type: "ping", nonce: i }));
  }
  await delay(100);
  expect(
    a.messages.some(
      (m) => m.type === "rejected" && m.reason === "Message rate limit",
    ),
  ).toBe(true);
  a.socket.close();
});

test("far-future and oversized traffic cannot retain a seat", async () => {
  await delay(50);
  const future = await connect();
  const baseline = future.messages[0];
  if (baseline?.type !== "baseline") throw new Error("No baseline");
  future.socket.send(
    JSON.stringify({
      type: "input",
      inputEpoch: baseline.inputEpoch,
      tick: baseline.tick + 100,
      moveX: 1,
      jumpPressed: true,
    }),
  );
  await delay(50);
  expect(
    future.messages.some(
      (message) =>
        message.type === "rejected" && message.reason.includes("future window"),
    ),
  ).toBe(true);
  future.socket.close();
  const oversized = await connect();
  oversized.socket.send("x".repeat(2049));
  await delay(100);
  expect(oversized.socket.readyState).toBe(WebSocket.CLOSED);
  expect(running.room.participants.size).toBe(0);
});

test("server restart closes old sockets and new admission gets fresh identity", async () => {
  const old = await connect();
  const before = old.messages[0];
  if (before?.type !== "baseline") throw new Error("No baseline");
  const port = running.server.port!;
  running.stop();
  await delay(50);
  expect(old.socket.readyState).toBe(WebSocket.CLOSED);
  running = await startServer(port);
  const fresh = await connect();
  const after = fresh.messages[0];
  if (after?.type !== "baseline") throw new Error("No new baseline");
  expect(after.playerId).not.toBe(before.playerId);
  expect(after.players).toHaveLength(1);
  fresh.socket.close();
});

test("resync recovers a baseline the client discarded during a preset change", async () => {
  await delay(50);
  const client = await connect();
  const first = client.messages[0];
  if (first?.type !== "baseline") throw new Error("No baseline");
  client.socket.send(
    JSON.stringify({ type: "resync", inputEpoch: first.inputEpoch }),
  );
  await delay(50);
  const second = client.messages
    .filter((message) => message.type === "baseline")
    .at(-1)!;
  client.socket.send(
    JSON.stringify({ type: "resync", inputEpoch: first.inputEpoch }),
  );
  await delay(50);
  const third = client.messages
    .filter((message) => message.type === "baseline")
    .at(-1)!;
  if (second.type !== "baseline" || third.type !== "baseline")
    throw new Error("No recovery baseline");
  expect(third.inputEpoch).toBeGreaterThan(second.inputEpoch);
  client.socket.close();
});

test("old protocol/content versions are explicitly rejected", async () => {
  await delay(50);
  for (const hello of [
    { type: "hello", protocol: 1, content: CONTENT_VERSION },
    { type: "hello", protocol: PROTOCOL_VERSION, content: "playground-1" },
  ]) {
    const client = await connect(hello);
    expect(client.messages[0]?.type).toBe("rejected");
    client.socket.close();
  }
});
test("global overrun baselines clear both buffered intentions before either send", async () => {
  await delay(50);
  const a = await connect(),
    b = await connect();
  try {
    for (const peer of running.room.participants.values())
      peer.state = {
        ...peer.state,
        y: 10,
        vy: 0,
        grounded: false,
        jumpBufferTicksRemaining: 6,
      };
    // Five catch-up steps leave one valid buffer tick, then the global rebase must clear it.
    const end = performance.now() + 140;
    while (performance.now() < end) {
      /* deliberate authoritative scheduler overrun */
    }
    await delay(60);
    const baselines = [a, b].map((client) =>
      client.messages.find(
        (m) => m.type === "baseline" && m.reason === "server overrun",
      ),
    );
    for (const baseline of baselines) {
      if (baseline?.type !== "baseline") throw new Error("No overrun baseline");
      expect(baseline.players).toHaveLength(2);
      expect(
        baseline.players.every((p) => p.jumpBufferTicksRemaining === 0),
      ).toBe(true);
    }
    if (baselines[0]?.type === "baseline" && baselines[1]?.type === "baseline")
      expect(baselines[0].players).toEqual(baselines[1].players);
  } finally {
    a.socket.close();
    b.socket.close();
  }
});
