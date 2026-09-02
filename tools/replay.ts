import { initializePhysics, fixtureTrace, replay } from "@derp/simulation";
import { parseTrace } from "@derp/protocol";
import {
  combatFixtureTrace,
  parseCombatTrace,
  replayCombatTrace,
} from "../apps/server/src/combat-replay";

const combat = process.argv.includes("--combat");
const file = process.argv.slice(2).find((argument) => argument !== "--combat");
const data = file
  ? await Bun.file(file).json()
  : combat
    ? combatFixtureTrace()
    : fixtureTrace();
await initializePhysics();

if (combat || data?.version === "projectile-lab-1") {
  const trace = parseCombatTrace(data?.combatTrace ?? data?.trace ?? data);
  const frames = replayCombatTrace(trace);
  const events = frames.flatMap((frame) => frame.events);
  console.log(
    JSON.stringify({
      trace: trace.version,
      ticks: frames.length,
      shots: events.filter((event) => event.type === "shot").length,
      terrainImpacts: events.filter(
        (event) => event.type === "impact" && event.target === "terrain",
      ).length,
      playerImpacts: events.filter(
        (event) => event.type === "impact" && event.target === "player",
      ).length,
      final: frames.at(-1),
    }),
  );
} else {
  const trace = parseTrace(data?.trace ?? data);
  const states = replay(trace);
  console.log(
    JSON.stringify({
      ticks: states.length,
      initial: trace.initial,
      final: states.at(-1) ?? trace.initial,
    }),
  );
}
