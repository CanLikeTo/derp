import { initializePhysics, fixtureTrace, replay } from "@derp/simulation";
import { parseTrace } from "@derp/protocol";
const file = process.argv[2];
const data = file ? await Bun.file(file).json() : fixtureTrace();
const trace = parseTrace(data?.trace ?? data);
await initializePhysics();
const states = replay(trace);
console.log(
  JSON.stringify({
    ticks: states.length,
    initial: trace.initial,
    final: states.at(-1) ?? trace.initial,
  }),
);
