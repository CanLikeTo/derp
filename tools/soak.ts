import { chromium, type Browser, type Page } from "@playwright/test";
import { heapProfile } from "./heap-profile";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { BUILD_ID, percentile } from "@derp/protocol";

const seconds = Number(process.argv[2] ?? 1800);
const jets = process.argv.includes("--jets");
const carbine = process.argv.includes("--carbine");
const profileMemory = process.argv.includes("--profile-memory");
const memory: unknown[] = [];
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 7200)
  throw new Error("Duration must be 10–7200 seconds (default 1800)");
const root = resolve(import.meta.dir, "..");
const runDirectory = resolve(
  root,
  "artifacts",
  `${BUILD_ID}-soak-${seconds}s-${Date.now()}`,
);
await mkdir(runDirectory, { recursive: true });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fingerprint() {
  const hasher = new Bun.CryptoHasher("sha256");
  const paths: string[] = [
    "bun.lock",
    "package.json",
    "apps/client/index.html",
    "apps/client/vite.config.ts",
    "tools/serve.ts",
    "tools/soak.ts",
    "tools/heap-profile.ts",
  ];
  for (const directory of ["apps", "packages"])
    for await (const file of new Bun.Glob("*/src/*.{ts,css}").scan({
      cwd: resolve(root, directory),
    }))
      paths.push(`${directory}/${file}`);
  for (const file of paths.sort()) {
    hasher.update(file);
    hasher.update(await Bun.file(resolve(root, file)).arrayBuffer());
  }
  return hasher.digest("hex");
}
const sourceHash = await fingerprint();
const child = Bun.spawn([process.execPath, "tools/serve.ts", "preview"], {
  cwd: root,
  stdout: Bun.file(resolve(runDirectory, "server.log")),
  stderr: "inherit",
});
let childExit: number | undefined;
child.exited.then((code) => {
  childExit = code;
});
const browsers: Browser[] = [],
  pages: Page[] = [];
const errors: string[] = [];
const rows: Record<string, unknown>[] = [];
const timingFile = Bun.file(resolve(runDirectory, "timing.jsonl")).writer();
const lastSequences = [0, 0];
const firing = [false, false];
let resets = 0,
  rejoins = 0;
const startedAt = new Date().toISOString();
let report: Record<string, unknown> = {};
async function join(page: Page) {
  await page.goto("http://127.0.0.1:4173/?test=1");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#connect").click();
  await page.waitForFunction(() => !!window.__derp?.diagnostics().predicted);
  await page.locator("#latency").selectOption("routine");
  await page.locator("#viewport").click({ position: { x: 20, y: 20 } });
  await page.waitForFunction(() =>
    window.__derp.diagnostics().status.includes("movement active"),
  );
  if (jets && !(await read(page)).rules.jetsEnabled) {
    await page.locator("#jets").click();
    await page.waitForFunction(
      () => window.__derp.diagnostics().rules.jetsEnabled,
    );
    await page.waitForFunction(() =>
      window.__derp.diagnostics().status.includes("movement active"),
    );
  }
}
async function read(page: Page): Promise<any> {
  return page.evaluate(() => window.__derp.diagnostics());
}
try {
  let ready = false;
  const readinessDeadline = performance.now() + 10000;
  for (let i = 0; i < 100; i++) {
    if (performance.now() > readinessDeadline) break;
    if (childExit !== undefined)
      throw new Error(
        `Server supervisor exited ${childExit}; ports must be free`,
      );
    try {
      const response = await fetch("http://127.0.0.1:4173", {
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      ready = response.ok;
      if (ready) break;
    } catch {
      /* starting */
    }
    await sleep(100);
  }
  if (!ready) throw new Error("Preview did not become ready");
  await sleep(250);
  if (childExit !== undefined) throw new Error("Server supervisor failed");
  for (let i = 0; i < 2; i++) {
    const browser = await chromium.launch({
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    });
    browsers.push(browser);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    pages.push(page);
    await join(page);
  }
  const begin = performance.now();
  for (let step = 0; step < seconds; step++) {
    if (childExit !== undefined) throw new Error("Server exited during soak");
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const right = (Math.floor(step / 4) + i) % 2 === 0;
      const arena = (await page.locator("#viewport canvas").boundingBox())!;
      const sweep = ((step * 37 + i * 53) % 101) / 100;
      const vertical = ((step * 61 + i * 29) % 101) / 100;
      await page.mouse.move(
        arena.x + arena.width * (0.05 + sweep * 0.9),
        arena.y + arena.height * (0.05 + vertical * 0.9),
      );
      if (carbine) {
        const nextFiring = step % 6 < 3;
        if (nextFiring !== firing[i]) {
          if (nextFiring) await page.mouse.down({ button: "left" });
          else await page.mouse.up({ button: "left" });
          firing[i] = nextFiring;
        }
        if (step % 17 === i) {
          await page.mouse.down({ button: "left" });
          await page.mouse.up({ button: "left" });
        }
      }
      await page.keyboard.up(right ? "KeyA" : "KeyD");
      await page.keyboard.down(right ? "KeyD" : "KeyA");
      if (step % 2 === i) await page.keyboard.press("Space");
      if (jets) {
        if (step % 3 === i)
          await page.keyboard.down(i ? "ShiftRight" : "ShiftLeft");
        else await page.keyboard.up(i ? "ShiftRight" : "ShiftLeft");
      }
    }
    if (step % 60 === 20) {
      await pages[0]!.locator("#reset").click();
      await pages[0]!
        .locator("#viewport")
        .click({ position: { x: 20, y: 20 } });
      resets++;
    }
    if (step % 60 === 40) {
      await pages[1]!.close();
      await sleep(150);
      const page = await browsers[1]!.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      pages[1] = page;
      firing[1] = false;
      lastSequences[1] = 0;
      await join(page);
      rejoins++;
    }
    if (step % 5 === 0) {
      const clients = await Promise.all(pages.map(read));
      for (let index = 0; index < pages.length; index++) {
        const records = await pages[index]!.evaluate(() =>
          window.__derp.timingRecords(),
        );
        const fresh = records.filter(
          (record) => Number(record.sequence) > lastSequences[index]!,
        );
        if (fresh.length) {
          timingFile.write(
            JSON.stringify({
              elapsed: (performance.now() - begin) / 1000,
              playerId: clients[index].playerId,
              records: fresh,
            }) + "\n",
          );
          lastSequences[index] = Number(fresh.at(-1)!.sequence);
        }
      }
      for (const client of clients) {
        if (
          !client.playerId ||
          !client.predicted ||
          client.players.length !== 2
        )
          throw new Error(`Lost participant: ${JSON.stringify(client)}`);
        if (
          client.pendingInputs > 120 ||
          client.interpolationDepth > 40 ||
          client.queues.incoming > 256 ||
          client.queues.outgoing > 256 ||
          client.renderer.players > 2 ||
          client.renderer.directionLines > 2 ||
          client.renderer.directionLines !== client.renderer.players ||
          client.renderer.reticles !== 1 ||
          client.renderer.projectileSlots !== 12 ||
          client.renderer.effectSlots !== 32 ||
          client.combat.provisionals > 16 ||
          client.combat.activeProjectiles > 12 ||
          client.combat.eventGaps !== 0 ||
          client.rules.jetsEnabled !== jets
        )
          throw new Error("Resource bound exceeded");
      }
      rows.push({ elapsed: (performance.now() - begin) / 1000, clients });
    }
    if (profileMemory && step >= 300 && step % 300 === 0) {
      for (let index = 0; index < pages.length; index++)
        memory.push(
          await heapProfile(
            pages[index]!,
            runDirectory,
            `heap-${step}-p${index + 1}`,
            step === 300,
          ),
        );
      await Bun.write(
        resolve(runDirectory, "heap-profile.json"),
        JSON.stringify(memory, null, 2),
      );
    }
    if (step % 60 === 0)
      console.log(
        JSON.stringify({
          elapsedSeconds: step,
          resets,
          rejoins,
          errors: errors.length,
          latest: (rows.at(-1) as any)?.clients?.map((d: any) => ({
            active: d.active,
            serverTick: d.serverTick,
            correctionP95: d.corrections.p95,
            rssMB: d.server.rssMB,
            tickP95: d.server.tickP95,
            frameP95: d.frameMs.p95,
          })),
        }),
      );
    if (errors.length) throw new Error(errors.join("; "));
    await sleep(Math.max(0, begin + (step + 1) * 1000 - performance.now()));
  }
  if (profileMemory) {
    for (let index = 0; index < pages.length; index++)
      memory.push(
        await heapProfile(
          pages[index]!,
          runDirectory,
          `heap-final-p${index + 1}`,
          true,
        ),
      );
    await Bun.write(
      resolve(runDirectory, "heap-profile.json"),
      JSON.stringify(memory, null, 2),
    );
  }
  const final = await Promise.all(pages.map(read));
  for (let i = 0; i < pages.length; i++)
    await pages[i]!.screenshot({
      path: resolve(runDirectory, `player-${i + 1}.png`),
      fullPage: true,
    });
  const warm = rows.filter(
    (row) => (row.elapsed as number) >= Math.min(300, seconds / 3),
  );
  const rss = warm.map((row: any) => row.clients[0].server.rssMB);
  const first = rss.slice(0, Math.max(1, Math.floor(rss.length / 3))),
    last = rss.slice(-Math.max(1, Math.floor(rss.length / 3)));
  const growthMB = percentile(last, 0.5) - percentile(first, 0.5);
  const clients = warm.flatMap((row: any) => row.clients);
  const budgets = {
    tickP95: Math.max(...clients.map((d) => d.server.tickP95)),
    tickP99: Math.max(...clients.map((d) => d.server.tickP99)),
    correctionP95: Math.max(...clients.map((d) => d.corrections.p95)),
    ordinaryCorrectionP95: Math.max(
      ...clients.map((d) => d.correctionsByActivity.ordinary.p95),
    ),
    thrustCorrectionP95: Math.max(
      ...clients.map((d) => d.correctionsByActivity.thrust.p95),
    ),
    aimCorrectionP95: Math.max(...clients.map((d) => d.aim.corrections.p95)),
    aimCorrectionMax: Math.max(...clients.map((d) => d.aim.corrections.max)),
    upstreamBps: Math.max(...clients.map((d) => d.upstreamBps)),
    downstreamBps: Math.max(...clients.map((d) => d.downstreamBps)),
    postWarmupMedianGrowthMB: growthMB,
  };
  const unchanged = sourceHash === (await fingerprint());
  const gates = {
    duration: seconds < 1800 || performance.now() - begin >= 1800000,
    cycles: seconds < 1800 || (resets >= 30 && rejoins >= 30),
    errors: errors.length === 0,
    sourceUnchanged: unchanged,
    tick: budgets.tickP95 <= 8 && budgets.tickP99 <= 12,
    corrections: budgets.correctionP95 < 0.08,
    aimCorrections: budgets.aimCorrectionP95 === 0,
    activityCorrections:
      !jets ||
      (budgets.ordinaryCorrectionP95 < 0.08 &&
        budgets.thrustCorrectionP95 < 0.08 &&
        clients.some((d) => d.correctionsByActivity.thrust.count > 0)),
    bandwidth: budgets.upstreamBps <= 8000 && budgets.downstreamBps <= 64000,
    memory: growthMB < 32,
    combat:
      !carbine ||
      clients.every(
        (client) =>
          client.server.capacityDrops === 0 &&
          client.combat.eventGaps === 0 &&
          client.combat.duplicateEvents === 0 &&
          client.combat.provisionals <= 16 &&
          client.combat.activeProjectiles <= 12 &&
          client.messageBytes.maxIncoming <= 16384 &&
          client.messageBytes.maxOutgoing <= 2048,
      ),
    renderer: clients.every(
      (client) =>
        client.renderer.sceneObjects <= 64 &&
        client.renderer.geometries <= 13 &&
        client.renderer.directionLines === client.renderer.players &&
        client.renderer.reticles === 1 &&
        client.renderer.projectileSlots === 12 &&
        client.renderer.effectSlots === 32 &&
        client.renderer.programs <= 6,
    ),
  };
  report = {
    completed: true,
    passed: Object.values(gates).every(Boolean),
    startedAt,
    finishedAt: new Date().toISOString(),
    durationSeconds: (performance.now() - begin) / 1000,
    requestedSeconds: seconds,
    profileMemory,
    jets,
    carbine,
    resets,
    rejoins,
    sourceHash,
    build: BUILD_ID,
    runtime: Bun.version,
    browser: browsers[0]!.version(),
    environment:
      "two isolated headless Chromium processes, 1440x1000, routine application latency; not a real GPU benchmark",
    gates,
    budgets,
    final,
    rows,
    errors,
  };
  if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
} catch (error) {
  const failedClients = await Promise.allSettled(pages.map(read));
  await Promise.allSettled(
    pages.map((page, index) =>
      page.screenshot({
        path: resolve(runDirectory, `failure-${index + 1}.png`),
        fullPage: true,
      }),
    ),
  );
  report = {
    completed: false,
    passed: false,
    startedAt,
    requestedSeconds: seconds,
    profileMemory,
    jets,
    carbine,
    sourceHash,
    resets,
    rejoins,
    error: String(error),
    failedClients,
    rows,
    errors,
  };
  process.exitCode = 1;
} finally {
  await timingFile.end();
  await Bun.write(
    resolve(runDirectory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, runDirectory, rows: undefined, final: undefined },
      null,
      2,
    ),
  );
  await Promise.all(browsers.map((browser) => browser.close()));
  child.kill("SIGTERM");
  await child.exited;
}
