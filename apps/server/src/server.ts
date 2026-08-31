import { initializePhysics, TICK_MS } from "@derp/simulation";
import {
  BUILD_ID,
  CONTENT_VERSION,
  PROTOCOL_VERSION,
  LIMITS,
  parseClient,
  Samples,
  type ServerMessage,
  type ServerStats,
} from "@derp/protocol";
import { Room } from "./room";
import type { ServerWebSocket } from "bun";

export class Outbox {
  pending: string | undefined;
  blockedAt: number | undefined;
  offer(
    raw: string,
    replaceable: boolean,
    socket: Pick<
      ServerWebSocket<unknown>,
      "getBufferedAmount" | "send" | "close"
    >,
    now: number,
  ) {
    const buffered = socket.getBufferedAmount();
    if (
      buffered > LIMITS.bufferedBytes ||
      (this.blockedAt !== undefined && now - this.blockedAt > 2000)
    ) {
      socket.close(1008, "Slow receiver");
      return 0;
    }
    if (buffered > 16384) {
      this.blockedAt ??= now;
      if (replaceable) {
        this.pending = raw;
        return 0;
      }
      socket.close(1008, "Control channel congested");
      return 0;
    }
    this.blockedAt = undefined;
    this.pending = undefined;
    const result = socket.send(raw);
    if (result === -1) this.blockedAt = now;
    if (result === 0) socket.close(1011, "Send failed");
    return result === 0 ? 0 : new TextEncoder().encode(raw).length;
  }
}
type SocketData = {
  id: string;
  joined: boolean;
  tokens: number;
  tokenTime: number;
  lastSeen: number;
  opened: number;
  lastControl: number;
  outbox: Outbox;
};
export async function startServer(port = 3001) {
  await initializePhysics();
  const room = new Room();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const tickSamples = new Samples();
  let cachedTicks = { p95: 0, p99: 0 },
    lastSummary = 0;
  let inBytes = 0,
    outBytes = 0,
    overruns = 0,
    scheduleMs = 0;
  let previous = performance.now(),
    accumulator = 0;
  const stats = (): ServerStats => ({
    tickP95: cachedTicks.p95,
    tickP99: cachedTicks.p99,
    scheduleMs,
    overruns,
    lateInputs: room.lateInputs,
    connections: room.participants.size,
    queuedInputs: [...room.participants.values()].reduce(
      (sum, peer) => sum + peer.inputs.size,
      0,
    ),
    rssMB: process.memoryUsage.rss() / 1048576,
    inBytes,
    outBytes,
  });
  function send(socket: ServerWebSocket<SocketData>, message: ServerMessage) {
    outBytes += socket.data.outbox.offer(
      JSON.stringify(message),
      message.type === "snapshot",
      socket,
      performance.now(),
    );
  }
  function reject(socket: ServerWebSocket<SocketData>, reason: string) {
    send(socket, { type: "rejected", reason });
    socket.close(1008, reason.slice(0, 100));
  }
  function state(
    socket: ServerWebSocket<SocketData>,
    type: "baseline" | "snapshot",
    reason = "",
  ) {
    const peer = room.participants.get(socket.data.id);
    if (peer)
      send(socket, {
        type,
        tick: room.tick,
        serverTime: performance.now(),
        playerId: socket.data.id,
        inputEpoch: peer.epoch,
        players: room.snapshot(),
        stats: stats(),
        reason,
      });
  }
  function rebaseAll(reason: string) {
    for (const socket of sockets)
      if (socket.data.joined) {
        room.baseline(socket.data.id);
        state(socket, "baseline", reason);
      }
  }
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      const url = new URL(request.url);
      if (request.headers.get("host") !== `127.0.0.1:${server.port}`)
        return new Response("Invalid host", { status: 403 });
      if (url.pathname === "/health" && request.method === "GET")
        return Response.json({
          ready: true,
          build: BUILD_ID,
          tick: room.tick,
          stats: stats(),
        });
      if (url.pathname !== "/ws" || request.method !== "GET")
        return new Response("Not found", { status: 404 });
      if (
        !["http://127.0.0.1:5173", "http://127.0.0.1:4173"].includes(
          request.headers.get("origin") ?? "",
        )
      )
        return new Response("Invalid origin", { status: 403 });
      if (sockets.size >= 8)
        return new Response("Connection limit", { status: 503 });
      const now = performance.now();
      if (
        server.upgrade(request, {
          data: {
            id: crypto.randomUUID(),
            joined: false,
            tokens: LIMITS.burst,
            tokenTime: now,
            lastSeen: now,
            opened: now,
            lastControl: -Infinity,
            outbox: new Outbox(),
          },
        })
      )
        return;
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      maxPayloadLength: LIMITS.messageBytes,
      backpressureLimit: LIMITS.bufferedBytes,
      closeOnBackpressureLimit: true,
      idleTimeout: 5,
      sendPings: true,
      open(socket) {
        sockets.add(socket);
      },
      message(socket, data) {
        const now = performance.now();
        const meta = socket.data;
        meta.tokens = Math.min(
          LIMITS.burst,
          meta.tokens + ((now - meta.tokenTime) * LIMITS.rate) / 1000,
        );
        meta.tokenTime = now;
        if (meta.tokens < 1) {
          reject(socket, "Message rate limit");
          return;
        }
        meta.tokens--;
        meta.lastSeen = now;
        if (typeof data !== "string") {
          reject(socket, "Text JSON required");
          return;
        }
        inBytes += new TextEncoder().encode(data).length;
        try {
          const message = parseClient(data);
          if (message.type === "hello") {
            if (meta.joined) throw new Error("Already joined");
            if (
              message.protocol !== PROTOCOL_VERSION ||
              message.content !== CONTENT_VERSION
            )
              throw new Error("Version mismatch; reload");
            if (!room.join(meta.id)) throw new Error("Room full (two players)");
            meta.joined = true;
            room.baseline(meta.id);
            state(socket, "baseline", "join");
            return;
          }
          if (!meta.joined) throw new Error("Hello required");
          if (message.type === "ping") {
            send(socket, {
              type: "pong",
              nonce: message.nonce,
              tick: room.tick,
              serverTime: now,
            });
            return;
          }
          // A resync must recover even if the client discarded a newer baseline.
          // The socket still owns the same player; only gameplay actions require its epoch.
          if (message.type === "resync") {
            room.baseline(meta.id);
            state(socket, "baseline", "resync");
            return;
          }
          const peer = room.participants.get(meta.id)!;
          if (message.inputEpoch !== peer.epoch) return;
          if (message.type === "input") {
            room.input(meta.id, message);
            return;
          }
          if (message.type === "suspend") {
            room.suspend(meta.id);
            return;
          }
          if (message.type === "reset") {
            if (now - meta.lastControl < 1000) return;
            meta.lastControl = now;
            room.reset();
            rebaseAll("room reset");
          }
        } catch (error) {
          reject(
            socket,
            error instanceof SyntaxError
              ? "Malformed JSON"
              : error instanceof Error
                ? error.message
                : "Invalid message",
          );
        }
      },
      pong(socket) {
        socket.data.lastSeen = performance.now();
      },
      close(socket) {
        sockets.delete(socket);
        room.leave(socket.data.id);
      },
    },
  });
  const timer = setInterval(() => {
    const start = performance.now();
    accumulator += start - previous;
    previous = start;
    scheduleMs = Math.max(0, accumulator - TICK_MS);
    let steps = 0;
    while (accumulator >= TICK_MS && steps < 5) {
      if (start - lastSummary >= 250) {
        cachedTicks = tickSamples.summary();
        lastSummary = start;
      }
      room.step();
      accumulator -= TICK_MS;
      steps++;
      if (room.tick % 3 === 0)
        for (const socket of sockets)
          if (socket.data.joined) state(socket, "snapshot");
    }
    if (accumulator >= TICK_MS) {
      overruns++;
      accumulator = 0;
      rebaseAll("server overrun");
    }
    if (steps) tickSamples.add(performance.now() - start);
  }, 4);
  const heartbeat = setInterval(() => {
    const now = performance.now();
    for (const socket of sockets) {
      if (
        (!socket.data.joined && now - socket.data.opened > 2000) ||
        now - socket.data.lastSeen > 5000
      )
        socket.close(1001, "Liveness timeout");
      else socket.ping();
    }
  }, 1000);
  return {
    server,
    room,
    stats,
    stop() {
      clearInterval(timer);
      clearInterval(heartbeat);
      server.stop(true);
      room.dispose();
    },
  };
}
