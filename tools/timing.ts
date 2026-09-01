import { mkdir } from "node:fs/promises";
import { timingScenario } from "../tests/fixtures/timing";
const directory = `artifacts/timing-${Date.now()}`;
await mkdir(directory, { recursive: true });
for (const adapt of [false, true]) {
  const result = await timingScenario({ adapt, increase: true, phase: 16 });
  await Bun.write(
    `${directory}/${adapt ? "adaptive" : "frozen"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      adapt,
      ...result,
      records: undefined,
      correctionRecords: undefined,
    }),
  );
}
console.log(directory);
const biased = await timingScenario({
  adapt: true,
  baselineDelay: 50,
  phase: 16,
});
await Bun.write(
  `${directory}/biased-baseline.json`,
  JSON.stringify(biased, null, 2),
);
console.log(
  JSON.stringify({
    scenario: "old clock delayed-baseline regression control",
    ...biased,
    records: undefined,
    correctionRecords: undefined,
  }),
);

const mapped = await timingScenario({
  adapt: true,
  mapClock: true,
  baselineDelay: 50,
  phase: 16,
});
await Bun.write(
  `${directory}/mapped-baseline.json`,
  JSON.stringify(mapped, null, 2),
);
console.log(
  JSON.stringify({
    scenario: "mapped delayed baseline",
    ...mapped,
    records: undefined,
    correctionRecords: undefined,
  }),
);
if (mapped.lateAfterSettling || mapped.corrections.p95 >= 0.08)
  process.exitCode = 1;

for (const schedulingMargin of [false, true]) {
  const result = await timingScenario({
    adapt: true,
    mapClock: true,
    repeatedStalls: true,
    schedulingMargin,
  });
  await Bun.write(
    `${directory}/scheduling-${schedulingMargin ? "measured" : "fixed"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      scenario: "repeated browser timer stalls",
      schedulingMargin,
      ...result,
      records: undefined,
      correctionRecords: undefined,
    }),
  );
  if (
    schedulingMargin &&
    (result.lateAfterSettling || result.corrections.p95 >= 0.08)
  )
    process.exitCode = 1;
}
