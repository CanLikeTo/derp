import { chromium } from "@playwright/test";
import { fixtureTrace, initializePhysics, replay } from "@derp/simulation";
await initializePhysics();
const expected = replay(fixtureTrace());
const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.goto(`${process.argv[2] ?? "http://127.0.0.1:5173"}?compat`);
  await page.waitForFunction(() =>
    document.querySelector("#app")?.textContent?.includes("browser-rapier"),
  );
  const actual = JSON.parse(await page.locator("#app").innerText());
  for (let i = 0; i < expected.length; i++) {
    const a = actual.states[i];
    const e = expected[i]!;
    if (
      Math.hypot(a.x - e.x, a.y - e.y) > 0.0001 ||
      Math.abs(a.vx - e.vx) > 0.0001 ||
      Math.abs(a.vy - e.vy) > 0.0001 ||
      a.grounded !== e.grounded ||
      a.coyoteTicksRemaining !== e.coyoteTicksRemaining ||
      a.jumpBufferTicksRemaining !== e.jumpBufferTicksRemaining
    )
      throw new Error(`Replay drift at ${i}`);
  }
  console.log(
    JSON.stringify({
      gate: "browser-rapier",
      passed: true,
      url: page.url(),
      ticks: expected.length,
    }),
  );
} finally {
  await browser.close();
}
