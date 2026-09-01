import { jetTraces } from "../fixtures/jets";
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
  rules: { jetsEnabled: boolean };
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
  lead: number;
  schedulingJitterMs: number;
  queues: { incoming: number; outgoing: number };
  renderer: {
    players: number;
    directionLines: number;
    reticles: number;
    sceneObjects: number;
  };
  corrections: { p95: number };
  aim: {
    pointerValid: boolean;
    reticleVisible: boolean;
    predictedQ?: number;
    authoritativeQ?: number;
    correctionSteps: number;
    corrections: { p95: number; max: number };
  };
};
declare global {
  interface Window {
    __derp: {
      diagnostics(): Diagnostic;
      timingRecords(): Record<string, string | number>[];
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
async function setJets(page: Page, enabled: boolean) {
  await focus(page);
  if ((await diagnostics(page)).rules.jetsEnabled !== enabled) {
    await page.locator("#jets").click();
    await expect
      .poll(async () => (await diagnostics(page)).rules.jetsEnabled)
      .toBe(enabled);
    await focus(page);
  }
}
async function expectLabelInsideArena(page: Page, slot: number) {
  const arena = (await page.locator("#viewport").boundingBox())!;
  const label = (await page.locator(`.player-label.p${slot}`).boundingBox())!;
  expect(label.x).toBeGreaterThanOrEqual(arena.x);
  expect(label.x + label.width).toBeLessThanOrEqual(arena.x + arena.width);
}

async function aimAtWorld(page: Page, x: number, y: number) {
  const canvas = (await page.locator("#viewport canvas").boundingBox())!;
  await page.mouse.move(
    canvas.x + ((x + 12) / 24) * canvas.width,
    canvas.y + (1 - y / 13.5) * canvas.height,
  );
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
    expect(actual[i]!.jetFuelTicksRemaining).toBe(
      expected[i]!.jetFuelTicksRemaining,
    );
    expect(actual[i]!.jetActive).toBe(expected[i]!.jetActive);
    expect(actual[i]!.coyoteTicksRemaining).toBe(
      expected[i]!.coyoteTicksRemaining,
    );
    expect(actual[i]!.jumpBufferTicksRemaining).toBe(
      expected[i]!.jumpBufferTicksRemaining,
    );
    expect(actual[i]!.aimQ).toBe(expected[i]!.aimQ);
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

test("mouse aim predicts before authority, survives resize and clears on leave", async ({
  page,
  browser,
}) => {
  await join(page);
  await focus(page);
  let state = (await diagnostics(page)).predicted!;
  await aimAtWorld(page, 11, state.y);
  await expect
    .poll(async () =>
      Math.abs((await diagnostics(page)).aim.predictedQ ?? 99_999),
    )
    .toBeLessThan(100);
  expect((await diagnostics(page)).aim).toMatchObject({
    pointerValid: true,
    reticleVisible: true,
  });
  await expect
    .poll(async () =>
      Math.abs((await diagnostics(page)).aim.authoritativeQ ?? 99_999),
    )
    .toBeLessThan(100);

  await page.locator("#latency").selectOption("routine");
  await focus(page);
  const beforeAuthority = (await diagnostics(page)).aim.authoritativeQ!;
  state = (await diagnostics(page)).predicted!;
  await aimAtWorld(page, state.x, 12);
  const immediateHandle = await page.waitForFunction(() => {
    const diagnostic = window.__derp.diagnostics();
    return Math.abs((diagnostic.aim.predictedQ ?? 0) - 16_384) < 100
      ? diagnostic
      : false;
  });
  const immediate = (await immediateHandle.jsonValue()) as Diagnostic;
  expect(immediate.aim.authoritativeQ).toBe(beforeAuthority);

  const otherContext = await browser.newContext({ deviceScaleFactor: 2 });
  const other = await otherContext.newPage();
  try {
    await join(other);
    await expect
      .poll(async () => (await diagnostics(other)).players.length)
      .toBe(2);
    await expect
      .poll(async () => (await diagnostics(other)).renderer.players)
      .toBe(2);
    expect((await diagnostics(other)).renderer).toMatchObject({
      players: 2,
      directionLines: 2,
      reticles: 1,
    });
    await page.setViewportSize({ width: 700, height: 900 });
    state = (await diagnostics(page)).predicted!;
    await aimAtWorld(page, -11, state.y);
    await expect
      .poll(async () => Math.abs((await diagnostics(page)).aim.predictedQ ?? 0))
      .toBeGreaterThan(32_600);
    const canvas = (await page.locator("#viewport canvas").boundingBox())!;
    await page.mouse.move(canvas.x - 4, canvas.y - 4);
    await expect
      .poll(async () => (await diagnostics(page)).aim.pointerValid)
      .toBe(false);
    expect((await diagnostics(page)).aim.reticleVisible).toBe(false);
  } finally {
    await otherContext.close();
  }
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
        "aimQ",
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

test("a delayed reset baseline uses server timestamps instead of biasing the input clock", async ({
  page,
}) => {
  let armed = false;
  let due = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      const delay = armed && message.type === "baseline" ? 150 : 0;
      if (delay) armed = false;
      due = Math.max(due, Date.now() + delay);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          socket.send(raw);
        },
        Math.max(0, due - Date.now()),
      );
      timers.add(timer);
    });
  });
  try {
    await join(page);
    await page.locator("#latency").selectOption("routine");
    await focus(page);
    const epoch = (await diagnostics(page)).inputEpoch;
    armed = true;
    await page.evaluate(() =>
      (document.getElementById("reset") as HTMLButtonElement).click(),
    );
    await expect
      .poll(async () => (await diagnostics(page)).inputEpoch)
      .toBeGreaterThan(epoch);
    const baselines = await page.evaluate(() =>
      window.__derp.timingRecords().filter((r) => r.stage === "baseline"),
    );
    const baseline = baselines.at(-1)!;
    expect(
      Number(baseline.estimatedTick) - Number(baseline.tick),
    ).toBeGreaterThan(9);
    for (let n = 0; n < 12; n++) {
      const key = n % 2 ? "KeyA" : "KeyD";
      await page.keyboard.down(key);
      await page.waitForTimeout(500);
      await page.keyboard.up(key);
    }
    expect((await diagnostics(page)).corrections.p95).toBeLessThan(0.08);
    expect((await diagnostics(page)).status).toContain("movement active");
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
});

test("short browser timer stalls add a bounded measured scheduling allowance", async ({
  page,
}) => {
  await join(page);
  await page.locator("#latency").selectOption("routine");
  await focus(page);
  const before = await diagnostics(page);
  await page.keyboard.down("KeyD");
  await page.evaluate(async () => {
    for (let n = 0; n < 8; n++) {
      await new Promise((resolve) => setTimeout(resolve, 230));
      const end = performance.now() + 70;
      while (performance.now() < end) {
        /* deliberate short main-thread stall */
      }
    }
  });
  await page.waitForTimeout(30);
  await page.keyboard.up("KeyD");
  const after = await diagnostics(page);
  expect(after.schedulingJitterMs).toBeGreaterThan(20);
  expect(after.lead).toBeGreaterThanOrEqual(before.lead);
  expect(after.lead).toBeLessThanOrEqual(12);
  expect(after.pendingInputs).toBeLessThanOrEqual(120);
  expect(after.status).toContain("movement active");
});

test("jet traces match Bun including every fuel tick and collision; roof labels remain inside", async ({
  page,
}) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => !!window.__derp);
  await initializePhysics();
  for (const [name, trace] of Object.entries(jetTraces())) {
    const expected = replay(trace),
      actual = await page.evaluate(
        (trace) => window.__derp.fixture(trace),
        trace,
      );
    expect(actual.length).toBe(expected.length);
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
        "jetFuelTicksRemaining",
        "jetActive",
        "aimQ",
      ] as const)
        expect(actual[i]![key], `${name}/${i}/${key}`).toBe(expected[i]![key]);
    }
  }
  await join(page);
  await focus(page);
  await setJets(page, true);
  // Move away from the ceiling fixture before the combined launch.
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyA");
  await expect
    .poll(async () => (await diagnostics(page)).predicted!.grounded)
    .toBe(true);
  await page.keyboard.down("Space");
  await page.keyboard.down("ShiftLeft");
  const sampled = await page.evaluate(
    () =>
      new Promise<{ peak: number; clipped: boolean }>((resolve) => {
        const end = performance.now() + 1500;
        let peak = 0,
          clipped = false;
        function sample() {
          peak = Math.max(peak, window.__derp.diagnostics().predicted!.y);
          const arena = document
            .getElementById("viewport")!
            .getBoundingClientRect();
          const label = document
            .querySelector(".player-label.p1")!
            .getBoundingClientRect();
          clipped ||=
            label.top < arena.top ||
            label.bottom > arena.bottom ||
            label.left < arena.left ||
            label.right > arena.right;
          if (performance.now() < end) requestAnimationFrame(sample);
          else resolve({ peak, clipped });
        }
        requestAnimationFrame(sample);
      }),
  );
  await page.keyboard.up("Space");
  await page.keyboard.up("ShiftLeft");
  expect(sampled.peak).toBeGreaterThan(12.08);
  expect(sampled.clipped).toBe(false);
  await setJets(page, false);
});

test("two players confirm jet mode; predicted fuel responds under latency and suspend clears Shift", async ({
  page,
  browser,
}) => {
  await join(page);
  await focus(page);
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await join(other);
    await focus(other);
    await setJets(page, false);
    expect((await diagnostics(page)).rules.jetsEnabled).toBe(false);
    const otherEpoch = (await diagnostics(other)).inputEpoch;
    await page.locator("#jets").click();
    await expect
      .poll(async () => (await diagnostics(page)).rules.jetsEnabled)
      .toBe(true);
    await expect
      .poll(async () => (await diagnostics(other)).rules.jetsEnabled)
      .toBe(true);
    expect((await diagnostics(other)).inputEpoch).toBeGreaterThan(otherEpoch);
    for (const preset of ["routine", "degraded", "local"]) {
      await page.locator("#latency").selectOption(preset);
      await focus(page);
      await expect
        .poll(
          async () =>
            (await diagnostics(page)).predicted!.jetFuelTicksRemaining,
        )
        .toBe(45);
      const before = await diagnostics(page);
      await page.keyboard.down("ShiftLeft");
      const observation = await page.waitForFunction(() => {
        const d = window.__derp.diagnostics();
        return d.predicted?.jetActive ? d : false;
      });
      const after = (await observation.jsonValue()) as Diagnostic;
      expect(after.predicted!.jetFuelTicksRemaining).toBeLessThan(45);
      if (preset !== "local")
        expect(after.authoritative!.jetFuelTicksRemaining).toBe(
          before.authoritative!.jetFuelTicksRemaining,
        );
      await expect(other.locator(".player-label.p1")).toContainText("JET");
      await page.keyboard.down("ShiftRight");
      await page.keyboard.up("ShiftLeft");
      await expect
        .poll(
          async () =>
            (await diagnostics(page)).predicted!.jetFuelTicksRemaining,
        )
        .toBe(0);
      await expect
        .poll(async () => (await diagnostics(page)).predicted!.grounded)
        .toBe(true);
      await page.waitForTimeout(200);
      expect((await diagnostics(page)).predicted!.jetFuelTicksRemaining).toBe(
        0,
      );
      await page.keyboard.up("ShiftRight");
      await expect
        .poll(
          async () =>
            (await diagnostics(page)).predicted!.jetFuelTicksRemaining,
        )
        .toBe(45);
    }
    await page.keyboard.down("ShiftLeft");
    await expect
      .poll(async () => (await diagnostics(page)).predicted!.jetActive)
      .toBe(true);
    await page.locator("#debug").focus();
    await expect
      .poll(async () => (await diagnostics(page)).authoritative!.jetActive)
      .toBe(false);
    expect((await diagnostics(page)).pendingInputs).toBe(0);
    await page.keyboard.up("ShiftLeft");
    await focus(page);
    const epoch = (await diagnostics(page)).inputEpoch;
    await page.keyboard.down("ShiftRight");
    await page.evaluate(() => window.__derp.stall());
    await expect
      .poll(async () => (await diagnostics(page)).inputEpoch)
      .toBeGreaterThan(epoch);
    expect((await diagnostics(page)).predicted!.jetActive).toBe(false);
    await page.keyboard.up("ShiftRight");
    await page.locator("#reset").click();
    await focus(page);
    expect((await diagnostics(page)).rules.jetsEnabled).toBe(true);
    await expect
      .poll(
        async () => (await diagnostics(page)).predicted!.jetFuelTicksRemaining,
      )
      .toBe(45);
    const trace = await page.evaluate(() => window.__derp.trace());
    expect(parseTrace(trace).rules.jetsEnabled).toBe(true);
    expect(
      parseTrace(trace).inputs.every((i) => typeof i.jetHeld === "boolean"),
    ).toBe(true);
    const previousId = (await diagnostics(page)).playerId;
    await page.reload();
    await page.locator("#connect").click();
    await focus(page);
    expect((await diagnostics(page)).playerId).not.toBe(previousId);
    expect((await diagnostics(page)).rules.jetsEnabled).toBe(true);
    expect((await diagnostics(page)).predicted!.jetFuelTicksRemaining).toBe(45);
    await expect(page.locator("#jets")).toBeEnabled();
    await page.locator("#jets").focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await diagnostics(other)).rules.jetsEnabled)
      .toBe(false);
    await expect(page.locator("#fuel-label")).toHaveText("Jets off");
    await expect(page.locator("#jets")).toBeEnabled();
    await page.locator("#latency").focus();
    await page.keyboard.press("Shift+Tab");
    // WebKit's native tab order can skip buttons and return to the explicit
    // arena tab stop. Either way Shift must not swallow backward navigation.
    expect(["jets", "viewport"]).toContain(
      await page.evaluate(() => document.activeElement?.id),
    );
  } finally {
    await otherContext.close();
  }
});
