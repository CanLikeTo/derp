import {
  initializePhysics,
  fixtureTrace,
  replay,
  Simulation,
  NEUTRAL,
} from "@derp/simulation";
await initializePhysics();
const trace = fixtureTrace();
const expected = replay(trace);
const sim = new Simulation();
let restored = expected[449]!;
sim.step({ ...restored, x: 9, y: 9 }, NEUTRAL, { jetsEnabled: false });
for (const input of trace.inputs.slice(450))
  restored = sim.step(restored, input, { jetsEnabled: false });
sim.dispose();
if (
  Math.hypot(restored.x - expected.at(-1)!.x, restored.y - expected.at(-1)!.y) >
  0.0001
)
  throw new Error("Restoration diverged");
console.log(
  JSON.stringify({ gate: "bun-rapier", passed: true, final: restored }),
);
