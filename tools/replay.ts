import {
  initializePhysics,
  fixtureTrace,
  replay,
  CONTENT_VERSION,
  type Trace,
} from "@derp/simulation";
import { validPlayer } from "@derp/protocol";
const file = process.argv[2];
const data = file ? await Bun.file(file).json() : fixtureTrace();
const trace = data.trace ?? data;
if (
  trace.version !== 1 ||
  trace.contentVersion !== CONTENT_VERSION ||
  !validPlayer(trace.initial) ||
  !Array.isArray(trace.inputs) ||
  trace.inputs.length > 10000 ||
  !trace.inputs.every(
    (input: { moveX: unknown; jumpPressed: unknown }) =>
      input &&
      [-1, 0, 1].includes(input.moveX as number) &&
      typeof input.jumpPressed === "boolean",
  )
)
  throw new Error("Invalid or incompatible trace");
await initializePhysics();
const states = replay(trace as Trace);
console.log(
  JSON.stringify({
    ticks: states.length,
    initial: trace.initial,
    final: states.at(-1) ?? trace.initial,
  }),
);
