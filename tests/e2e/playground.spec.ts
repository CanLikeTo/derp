import { jumpTraces } from "../fixtures/jumps";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseTrace, BUILD_ID, PROTOCOL_VERSION } from "@derp/protocol";
import { test, expect, type Page } from "@playwright/test";
import {
  initializePhysics,
  fixtureTrace,
  replay,
  type Trace,
  type PlayerState,
} from "@derp/simulation";
type Diagnostic = {
  status: string;
  active: boolean;
  playerId: string;
  inputEpoch: number;
  pendingInputs: number;
  predictedTick: number;
  finalizedTick: number;
  predicted?: PlayerState;
  authoritative?: PlayerState;
  players: { id: string }[];
  resyncs: number;
  queues: { incoming: number; outgoing: number };
  renderer: { players: number; sceneObjects: number };
  corrections: { p95: number };
};
declare global {
  interface Window {
    __derp: {
      diagnostics(): Diagnostic;
      fixture(trace?: Trace): ReturnType<typeof replay>;
      perturb(): void;
      stall(): void;
      trace(): unknown;
    };
  }
}
const diagnostics = (page: Page) =>
  page.evaluate(() => window.__derp.diagnostics());
async function join(page: Page) {
  await page.goto("/?test=1");
  await page
    .getByRole("button", { name: "Connect", exact: false })
    .first()
    .click();
  await expect
    .poll(async () => !!(await diagnostics(page)).predicted)
    .toBe(true);
}
async function focus(page: Page) {
  await page.bringToFront();
  await page.locator("#viewport").click({ position: { x: 20, y: 20 } });
  await expect
    .poll(async () => (await diagnostics(page)).status)
    .toContain("movement active");
}
async function expectLabelInsideArena(page: Page, slot: number) {
  const arena = (await page.locator("#viewport").boundingBox())!;
  const label = (await page.locator(`.player-label.p${slot}`).boundingBox())!;
  expect(label.x).toBeGreaterThanOrEqual(arena.x);
  expect(label.x + label.width).toBeLessThanOrEqual(arena.x + arena.width);
}

test("Rapier Bun/browser parity and usable fixed-aspect scene", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?test=1");
  await page.waitForFunction(() => !!window.__derp);
  await initializePhysics();
  const expected = replay(fixtureTrace());
  const actual = await page.evaluate(() => window.__derp.fixture());
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(
      Math.hypot(actual[i]!.x - expected[i]!.x, actual[i]!.y - expected[i]!.y),
    ).toBeLessThan(0.0001);
    expect(Math.abs(actual[i]!.vx - expected[i]!.vx)).toBeLessThan(0.0001);
    expect(Math.abs(actual[i]!.vy - expected[i]!.vy)).toBeLessThan(0.0001);
    expect(actual[i]!.grounded).toBe(expected[i]!.grounded);
    expect(actual[i]!.coyoteTicksRemaining).toBe(
      expected[i]!.coyoteTicksRemaining,
    );
    expect(actual[i]!.jumpBufferTicksRemaining).toBe(
      expected[i]!.jumpBufferTicksRemaining,
    );
  }
  await join(page);
  await page.getByLabel("Show collision / server ghost").check();
  await page.screenshot({
    path: `artifacts/playground-${testInfo.project.name}.png`,
    fullPage: true,
  });
  for (const width of [700, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const box = await page.locator("#viewport").boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  }
  expect(errors).toEqual([]);
});
test("two identities, movement, third rejection, reset and released seat", async ({
  page,
  context,
}) => {
  await join(page);
  const second = await context.newPage();
  await join(second);
  await expect
    .poll(async () => (await diagnostics(second)).players.length)
    .toBe(2);
  const firstId = (await diagnostics(page)).playerId;
  expect((await diagnostics(second)).playerId).not.toBe(firstId);
  const third = await context.newPage();
  await third.goto("/?test=1");
  await third.locator("#connect").click();
  await expect(third.locator("#status")).toContainText("Room full");
  await focus(page);
  const before = (await diagnostics(page)).predicted!.x;
  await page.keyboard.down("KeyD");
  await expect
    .poll(async () => (await diagnostics(page)).predicted!.x)
    .toBeGreaterThan(before + 0.3);
  await page.keyboard.up("KeyD");
  await page.keyboard.down("KeyA");
  await expect
    .poll(async () => (await diagnostics(page)).predicted!.x)
    .toBeLessThan(-11.58);
  await page.keyboard.up("KeyA");
  await expectLabelInsideArena(page, 1);
  await focus(second);
  await second.keyboard.down("KeyD");
  await expect
    .poll(async () => (await diagnostics(second)).predicted!.x)
    .toBeGreaterThan(11.58);
  await second.keyboard.up("KeyD");
  await expectLabelInsideArena(second, 2);
  await focus(page);
  const oldEpoch = (await diagnostics(page)).inputEpoch;
  await page.locator("#reset").click();
  await expect
    .poll(async () => (await diagnostics(page)).inputEpoch)
    .toBeGreaterThan(oldEpoch);
  await second.close();
  await expect
    .poll(async () => (await diagnostics(page)).players.length)
    .toBe(1);
  await third.locator("#reconnect").click();
  await expect
    .poll(async () => (await diagnostics(third)).players.length)
    .toBe(2);
  await third.close();
});
test("prediction precedes acknowledgement; latency, correction, blur and stall recover", async ({
  page,
  context,
}) => {
  await join(page);
  const observer = await context.newPage();
  await join(observer);
  for (const preset of ["routine", "degraded", "local"]) {
    await page.locator("#latency").selectOption(preset);
    await focus(page);
    const before = await diagnostics(page);
    expect(before.players).toHaveLength(2);
    await page.keyboard.down("KeyD");
    // Capture the first observed movement atomically; a second automation round trip
    // can observe a later acknowledgement or resync instead of that movement.
    const observation = await page.waitForFunction((x) => {
      const data = window.__derp.diagnostics();
      return data.predicted && data.predicted.x > x + 0.05 ? data : false;
    }, before.predicted!.x);
    const after = (await observation.jsonValue()) as Diagnostic;
    if (preset !== "local") {
      expect(after.finalizedTick).toBeLessThan(after.predictedTick);
      expect(after.authoritative!.x).toBeCloseTo(before.authoritative!.x, 4);
    }
    await page.keyboard.up("KeyD");
    await page.evaluate(() => window.__derp.perturb());
    await expect
      .poll(async () => {
        const d = await diagnostics(page);
        return Math.abs(d.predicted!.x - d.authoritative!.x);
      })
      .toBeLessThan(0.0001);
    expect((await diagnostics(page)).pendingInputs).toBeLessThanOrEqual(120);
    await page.locator("#reset").click();
    await focus(page);
  }
  await page.keyboard.down("KeyD");
  await page.locator("#debug").focus();
  await expect(page.locator("#status")).toContainText("paused");
  await page.waitForTimeout(350);
  const paused = await diagnostics(page);
  expect(paused.pendingInputs).toBe(0);
  expect(paused.predictedTick).toBe(paused.finalizedTick);
  expect(paused.predicted!.jumpBufferTicksRemaining).toBe(0);
  const pausedX = paused.authoritative!.x;
  await page.waitForTimeout(300);
  expect((await diagnostics(page)).authoritative!.x).toBeCloseTo(pausedX, 4);
  await page.keyboard.up("KeyD");
  await focus(page);
  const epoch = (await diagnostics(page)).inputEpoch;
  await page.evaluate(() => window.__derp.stall());
  await expect
    .poll(async () => (await diagnostics(page)).inputEpoch)
    .toBeGreaterThan(epoch);
  await expect(page.locator("#status")).toContainText("movement active");
  await page.keyboard.down("KeyD");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#status")).toContainText("paused");
  await page.waitForTimeout(350);
  const hidden = await diagnostics(page);
  expect(hidden.pendingInputs).toBe(0);
  expect(hidden.predictedTick).toBe(hidden.finalizedTick);
  expect(hidden.predicted!.jumpBufferTicksRemaining).toBe(0);
  await page.waitForTimeout(300);
  expect((await diagnostics(page)).authoritative!.x).toBeCloseTo(
    hidden.authoritative!.x,
    4,
  );
  await page.keyboard.up("KeyD");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await diagnostics(page)).inputEpoch)
    .toBeGreaterThan(hidden.inputEpoch);
  await expect(page.locator("#status")).toContainText("movement active");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/derp-diagnostics/);
  const path = (await download.path())!;
  const exported = JSON.parse(readFileSync(path, "utf8"));
  expect(exported.version).toBe(1);
  expect(exported.diagnostics.build).toBe(BUILD_ID);
  expect(exported.diagnostics.protocol).toBe(PROTOCOL_VERSION);
  const trace = parseTrace(exported.trace);
  const output = JSON.parse(
    execFileSync("bun", ["run", "replay", path], { encoding: "utf8" }),
  );
  await initializePhysics();
  expect(output.final).toEqual(replay(trace).at(-1) ?? trace.initial);
  await observer.close();
});
test("WebGL2 failure explains requirements", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
  });
  await page.goto("/?test=1");
  await expect(page.locator("#app")).toContainText(
    "WebGL2 and WebAssembly are required",
  );
});
test("reload creates a fresh identity and preserves a usable connection", async ({
  page,
}) => {
  await join(page);
  await focus(page);
  const old = (await diagnostics(page)).playerId;
  await page.reload();
  await page.locator("#connect").click();
  await focus(page);
  expect((await diagnostics(page)).playerId).not.toBe(old);
  expect((await diagnostics(page)).players.length).toBe(1);
});

test("latency changes during initial handshake recover repeatedly", async ({
  page,
}) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    await join(page);
    await page.locator("#latency").selectOption("routine");
    await page.locator("#latency").selectOption("degraded");
    await page.locator("#latency").selectOption("routine");
    await focus(page);
    expect((await diagnostics(page)).playerId).not.toBe("");
    await page.locator("#disconnect").click();
  }
});

test("changing latency before the first hello preserves admission", async ({
  page,
}) => {
  await page.goto("/?test=1");
  await page.locator("#latency").selectOption("degraded");
  await page.locator("#connect").click();
  await page.waitForFunction(
    () => window.__derp.diagnostics().queues.outgoing > 0,
  );
  await page.evaluate(() => {
    const latency = document.getElementById("latency") as HTMLSelectElement;
    latency.value = "routine";
    latency.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await focus(page);
  expect((await diagnostics(page)).players).toHaveLength(1);
});

test("jump forgiveness fixtures match Bun at every tick including boundary counters", async ({
  page,
}) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => !!window.__derp);
  await initializePhysics();
  for (const [name, trace] of Object.entries(jumpTraces())) {
    const expected = replay(trace);
    const actual = await page.evaluate(
      (trace) => window.__derp.fixture(trace),
      trace,
    );
    expect(actual.length, name).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      for (const key of ["x", "y", "vx", "vy"] as const)
        expect(
          Math.abs(actual[i]![key] - expected[i]![key]),
          `${name}/${i}/${key}`,
        ).toBeLessThan(0.0001);
      for (const key of [
        "grounded",
        "coyoteTicksRemaining",
        "jumpBufferTicksRemaining",
      ] as const)
        expect(actual[i]![key], `${name}/${i}/${key}`).toBe(expected[i]![key]);
    }
  }
});
test("unsolicited room baseline clears held keys and Space cannot cause repeated jumping", async ({
  page,
  browser,
}) => {
  await join(page);
  await focus(page);
  // Separate context prevents bringing the controller page forward from blurring the player.
  const otherContext = await browser.newContext();
  const second = await otherContext.newPage();
  try {
    await join(second);
    await focus(page);
    await page.keyboard.down("KeyD");
    await expect
      .poll(async () => (await diagnostics(page)).predicted!.vx)
      .toBeGreaterThan(0);
    // The second page may still be calibrating after its first baseline.
    await expect(second.locator("#reset")).toBeEnabled();
    const epoch = (await diagnostics(page)).inputEpoch;
    await second.evaluate(() =>
      (document.getElementById("reset") as HTMLButtonElement).click(),
    );
    await expect
      .poll(async () => (await diagnostics(page)).inputEpoch)
      .toBeGreaterThan(epoch);
    await expect
      .poll(async () => (await diagnostics(page)).predicted!.vx)
      .toBe(0);
    await page.waitForTimeout(300);
    expect((await diagnostics(page)).predicted!.x).toBeCloseTo(-8, 4);
    await page.keyboard.up("KeyD");
    await focus(page);
    await expect
      .poll(async () => (await diagnostics(page)).predicted!.grounded)
      .toBe(true);
    await page.keyboard.down("Space");
    await expect
      .poll(async () => (await diagnostics(page)).predicted!.y)
      .toBeGreaterThan(1.1);
    for (let i = 0; i < 4; i++) await page.keyboard.down("Space");
    await expect
      .poll(async () => (await diagnostics(page)).predicted!.grounded)
      .toBe(true);
    await page.waitForTimeout(350);
    expect((await diagnostics(page)).predicted!.grounded).toBe(true);
    expect((await diagnostics(page)).predicted!.jumpBufferTicksRemaining).toBe(
      0,
    );
    await page.keyboard.up("Space");
  } finally {
    await otherContext.close();
  }
});
