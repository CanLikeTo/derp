import { percentile } from "@derp/protocol";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const path = process.argv[2];
if (!path)
  throw new Error("Usage: bun tools/analyze-timing.ts path/to/timing.jsonl");
type Row = Record<string, number | string>;
type Command = { generated?: Row; sent?: Row; receipts: Row[] };
const commands = new Map<string, Command>();
const corrections: Row[] = [];
const baselines: Row[] = [];
let clockObservations = 0;
const key = (id: string, epoch: number, tick: number) =>
  `${id}/${epoch}/${tick}`;
const lines = createInterface({
  input: createReadStream(path),
  crlfDelay: Infinity,
});
for await (const line of lines) {
  if (!line.trim()) continue;
  // A live log may end with an incomplete write; only complete records count.
  let batch: { playerId: string; records: Row[] };
  try {
    batch = JSON.parse(line);
  } catch {
    continue;
  }
  for (const row of batch.records) {
    const id = String(row.playerId ?? batch.playerId);
    if (row.stage === "correction") {
      corrections.push({ ...row, playerId: id });
      continue;
    }
    if (row.stage === "baseline") {
      baselines.push(row);
      continue;
    }
    if (row.stage === "clock") {
      clockObservations++;
      continue;
    }
    if (!["generated", "sent", "receipt"].includes(String(row.stage))) continue;
    const k = key(id, Number(row.inputEpoch), Number(row.tick));
    const command = commands.get(k) ?? { receipts: [] };
    commands.set(k, command);
    if (row.stage === "generated") command.generated = row;
    else if (row.stage === "sent") command.sent = row;
    else if (
      row.stage === "receipt" &&
      !command.receipts.some(
        (r) => r.receivedAt === row.receivedAt && r.outcome === row.outcome,
      )
    )
      command.receipts.push(row);
  }
}
const perPlayer: Record<
  string,
  {
    corrections: number[];
    late: number;
    accepted: number;
    sendDelays: number[];
    headroom: number[];
  }
> = {};
const get = (id: string) =>
  (perPlayer[id] ??= {
    corrections: [],
    late: 0,
    accepted: 0,
    sendDelays: [],
    headroom: [],
  });
for (const [k, command] of commands) {
  const summary = get(k.split("/")[0]!);
  if (command.generated && command.sent)
    summary.sendDelays.push(
      Number(command.sent.at) - Number(command.generated.at),
    );
  for (const r of command.receipts) {
    if (r.outcome === "accepted") {
      summary.accepted++;
      summary.headroom.push(Number(r.tick) - Number(r.receivedTick));
    } else if (r.outcome === "late") summary.late++;
  }
}
let correlated = 0;
const examples: unknown[] = [];
const unmatchedExamples: unknown[] = [];
for (const row of corrections) {
  get(String(row.playerId)).corrections.push(Number(row.magnitude));
  if (Number(row.magnitude) < 0.08) continue;
  const inputs = [2, 1, 0].map((offset) => {
    const tick = Number(row.tick) - offset;
    const command = commands.get(
      key(String(row.playerId), Number(row.inputEpoch), tick),
    );
    return { tick, ...command };
  });
  const matched = inputs.some((input) =>
    input.receipts?.some((r) => r.outcome === "late"),
  );
  if (matched) correlated++;
  else if (unmatchedExamples.length < 10)
    unmatchedExamples.push({ correction: row, inputs });
  if (examples.length < 30) examples.push({ correction: row, inputs });
}
console.log(
  JSON.stringify(
    {
      file: path,
      commands: commands.size,
      clockObservations,
      baselines: baselines.length,
      estimatedBaselineAgeTicksP95: percentile(
        baselines.map((r) => Number(r.estimatedTick) - Number(r.tick)),
        0.95,
      ),
      corrections: corrections.length,
      correctionsAboveBudget: corrections.filter(
        (r) => Number(r.magnitude) >= 0.08,
      ).length,
      withLateReceiptWithinLastThreeTicks: correlated,
      caveat:
        "Correlation is not proof of cause; receipt tails can omit commands and frame gaps can exceed one snapshot interval. No cross-process clock subtraction.",
      players: Object.entries(perPlayer).map(([id, p]) => ({
        id,
        observedAccepted: p.accepted,
        observedLate: p.late,
        correctionP95: percentile(p.corrections, 0.95),
        sendDelayP95Ms: percentile(p.sendDelays, 0.95),
        minAcceptedHeadroomTicks: p.headroom.reduce(
          (a, b) => Math.min(a, b),
          Infinity,
        ),
        medianAcceptedHeadroomTicks: percentile(p.headroom, 0.5),
      })),
      examples,
      unmatchedExamples,
    },
    null,
    2,
  ),
);
