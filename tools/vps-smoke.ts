import {
  chromium,
  firefox,
  webkit,
  request,
  expect,
  type Page,
  type APIResponse,
} from "@playwright/test";
import { BUILD_ID } from "@derp/protocol";

interface RemoteDiagnostic {
  build: string;
  status: string;
  playerId: string;
  inputEpoch: number;
  serverTick: number;
  predicted?: { x: number };
  players: { id: string; x: number }[];
}
class SmokeFailure extends Error {}
function requireResult(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}
const timeout = 45_000;
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDiagnostic(value: unknown): value is RemoteDiagnostic {
  return (
    isObject(value) &&
    typeof value.build === "string" &&
    typeof value.status === "string" &&
    typeof value.playerId === "string" &&
    typeof value.inputEpoch === "number" &&
    typeof value.serverTick === "number" &&
    (value.predicted === undefined ||
      (isObject(value.predicted) && typeof value.predicted.x === "number")) &&
    Array.isArray(value.players) &&
    value.players.every(
      (player: unknown) =>
        isObject(player) &&
        typeof player.id === "string" &&
        typeof player.x === "number",
    )
  );
}
async function diagnostics(page: Page): Promise<RemoteDiagnostic> {
  const value: unknown = await page.evaluate(() => {
    const hook: unknown = Reflect.get(window, "__derp");
    if (
      !hook ||
      typeof hook !== "object" ||
      !("diagnostics" in hook) ||
      typeof hook.diagnostics !== "function"
    )
      throw new Error("Missing requested diagnostic hook");
    return hook.diagnostics();
  });
  requireResult(isDiagnostic(value), "Malformed browser diagnostics");
  return value;
}
async function focus(page: Page) {
  await page.bringToFront();
  await page.locator("#viewport").click({ position: { x: 20, y: 20 } });
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect
      .poll(async () => (await diagnostics(page)).status, { timeout })
      .toContain("movement active");
    const epoch = (await diagnostics(page)).inputEpoch;
    await page.waitForTimeout(50);
    const settled = await diagnostics(page);
    if (
      settled.status.includes("movement active") &&
      settled.inputEpoch === epoch
    )
      return;
  }
  throw new SmokeFailure("Arena focus did not settle");
}
async function join(page: Page, origin: string) {
  await page.goto(`${origin}/?test=1`);
  await page.locator("#connect").click();
  await expect
    .poll(async () => !!(await diagnostics(page)).predicted, { timeout })
    .toBe(true);
}
function challenge(response: APIResponse) {
  requireResult(response.status() === 401, "Expected HTTP 401");
  requireResult(
    /^Basic(?:\s|$)/i.test(response.headers()["www-authenticate"] ?? ""),
    "Missing Basic challenge",
  );
}
let stage = "configuration";
async function smoke() {
  const origin = process.env.DERP_VPS_URL;
  const username = process.env.DERP_BASIC_USER;
  const password = process.env.DERP_BASIC_PASSWORD;
  let parsed: URL;
  try {
    parsed = new URL(origin ?? "");
  } catch {
    throw new SmokeFailure("DERP_VPS_URL must be a canonical HTTPS origin");
  }
  requireResult(
    origin &&
      parsed.protocol === "https:" &&
      parsed.hostname &&
      !/[*,]/.test(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      parsed.origin === origin,
    "DERP_VPS_URL must be a canonical HTTPS origin",
  );
  requireResult(
    username && password,
    "DERP_BASIC_USER and DERP_BASIC_PASSWORD are required",
  );
  const anonymous = await request.newContext({
    timeout: 10_000,
    maxRedirects: 0,
  });
  try {
    const authenticated = await request.newContext({
      timeout: 10_000,
      maxRedirects: 0,
      httpCredentials: { username, password, origin, send: "always" },
    });
    try {
      stage = "HTTP authenticated /";
      const html = await authenticated.get(`${origin}/`);
      requireResult(html.status() === 200, "Expected authenticated HTML");
      const emitted = [
        ...(await html.text()).matchAll(/(?:src|href)="([^"]+)"/g),
      ]
        .map((match) => new URL(match[1]!, origin))
        .find((url) => /\.(js|css)$/.test(url.pathname));
      requireResult(
        emitted?.origin === origin,
        "No same-origin emitted asset found in HTML",
      );
      const upgrade = {
        Origin: origin,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      };
      for (const path of ["/", emitted.pathname, "/health", "/ws"]) {
        stage = `HTTP unauthenticated ${path}`;
        challenge(
          await anonymous.get(`${origin}${path}`, {
            headers: path === "/ws" ? upgrade : {},
          }),
        );
        console.log(`PASS ${path}: unauthenticated 401 + Basic challenge`);
        stage = `HTTP incorrect password ${path}`;
        challenge(
          await anonymous.get(`${origin}${path}`, {
            headers: {
              ...(path === "/ws" ? upgrade : {}),
              Authorization: `Basic ${Buffer.from(`${username}:${password.startsWith("x") ? "y" : "x"}${password}`).toString("base64")}`,
            },
          }),
        );
        console.log(`PASS ${path}: incorrect password 401`);
      }
      stage = "HTTP redirect";
      const redirect = await anonymous.get(`http://${parsed.hostname}/`);
      requireResult(
        redirect.status() === 308 &&
          redirect.headers().location === `${origin}/` &&
          !redirect.headers()["www-authenticate"] &&
          (await redirect.text()).trim() === "",
        "Expected empty HTTP 308 to the HTTPS origin, without an auth prompt",
      );
      console.log("PASS HTTP: 308 to HTTPS, no credentials or game body");
      stage = "HTTP authenticated /health";
      const health = async () => {
        const response = await authenticated.get(`${origin}/health`);
        requireResult(response.status() === 200, "Expected health HTTP 200");
        const value: unknown = await response.json();
        requireResult(
          isObject(value) &&
            value.ready === true &&
            value.build === BUILD_ID &&
            typeof value.tick === "number" &&
            isObject(value.stats) &&
            typeof value.stats.connections === "number",
          "Health readiness/build/tick mismatch",
        );
        return { tick: value.tick, connections: value.stats.connections };
      };
      const initial = await health();
      await expect
        .poll(async () => (await health()).tick!, { timeout })
        .toBeGreaterThan(initial.tick!);
      console.log(`PASS /health: ${BUILD_ID}, advancing ticks`);
      for (const headers of [{}, { Origin: "https://uninvited.invalid" }]) {
        stage = "HTTP /ws rejected Origin";
        const response = await authenticated.get(`${origin}/ws`, { headers });
        requireResult(
          response.status() === 403,
          "Expected rejected Origin HTTP 403",
        );
      }
      console.log("PASS /ws: missing and hostile Origin 403");
      for (const engine of [chromium, firefox, webkit]) {
        stage = `${engine.name()} empty room`;
        await expect
          .poll(async () => (await health()).connections, { timeout })
          .toBe(0);
        stage = `${engine.name()} launch/navigation/authenticated WSS`;
        const browser = await engine.launch();
        try {
          const context = await browser.newContext({
            httpCredentials: { username, password, origin },
          });
          try {
            context.setDefaultTimeout(timeout);
            context.setDefaultNavigationTimeout(timeout);
            const errors: string[] = [];
            const sockets: string[] = [];
            const page = async () => {
              const value = await context.newPage();
              value.on("pageerror", () => errors.push("page error"));
              value.on("websocket", (socket) => sockets.push(socket.url()));
              return value;
            };
            const first = await page();
            const second = await page();
            await join(first, origin);
            await join(second, origin);
            for (const participant of [first, second]) {
              await expect
                .poll(
                  async () => (await diagnostics(participant)).players.length,
                  { timeout },
                )
                .toBe(2);
            }
            const a = await diagnostics(first);
            const b = await diagnostics(second);
            requireResult(
              a.playerId &&
                b.playerId &&
                a.playerId !== b.playerId &&
                a.build === BUILD_ID &&
                b.build === BUILD_ID,
              "Distinct player identities/build agreement missing",
            );
            await expect
              .poll(async () => (await diagnostics(first)).serverTick, {
                timeout,
              })
              .toBeGreaterThan(a.serverTick);
            stage = `${engine.name()} predicted and observer-authoritative movement`;
            await focus(first);
            const before = (await diagnostics(first)).predicted!.x;
            const observerBefore = (await diagnostics(second)).players.find(
              (p) => p.id === a.playerId,
            )!.x;
            await first.keyboard.down("KeyD");
            try {
              await expect
                .poll(async () => (await diagnostics(first)).predicted!.x, {
                  timeout,
                })
                .toBeGreaterThan(before + 0.3);
            } finally {
              await first.keyboard.up("KeyD");
            }
            await expect
              .poll(
                async () =>
                  (await diagnostics(second)).players.find(
                    (p) => p.id === a.playerId,
                  )?.x ?? -Infinity,
                { timeout },
              )
              .toBeGreaterThan(observerBefore + 0.3);
            const after = (await diagnostics(first)).predicted!.x;
            stage = `${engine.name()} third rejection and seat reuse`;
            const third = await page();
            await third.goto(`${origin}/?test=1`);
            await third.locator("#connect").click();
            await expect(third.locator("#status")).toContainText("Room full", {
              timeout,
            });
            await second.close();
            await expect
              .poll(async () => (await diagnostics(first)).players.length, {
                timeout,
              })
              .toBe(1);
            await third.locator("#reconnect").click();
            for (const participant of [first, third]) {
              await expect
                .poll(
                  async () => (await diagnostics(participant)).players.length,
                  { timeout },
                )
                .toBe(2);
            }
            requireResult(
              sockets.length >= 3 &&
                sockets.every(
                  (url) => url === `${origin.replace(/^https:/, "wss:")}/ws`,
                ),
              "Browser did not use exclusively same-origin WSS",
            );
            requireResult(errors.length === 0, "Browser page errors observed");
            console.log(
              `PASS ${engine.name()}: ${BUILD_ID}; players ${a.playerId}, ${b.playerId}; tick ${a.serverTick}; predicted movement ${(after - before).toFixed(3)}; observer movement, Room full, seat reuse, WSS`,
            );
          } finally {
            await context.close();
          }
        } finally {
          await browser.close();
        }
      }
    } finally {
      await authenticated.dispose();
    }
  } finally {
    await anonymous.dispose();
  }
}
try {
  await smoke();
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof SmokeFailure ? error.message : "request/browser operation failed (details suppressed to protect credentials)"}`,
  );
  process.exitCode = 1;
}
