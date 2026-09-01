export {};
// Summarize V8 heap snapshots locally without retaining a browser connection.
// Counts/self sizes are supporting evidence, not a dominator/retaining-path proof.
const file = process.argv[2];
if (!file) throw new Error("Expected a .heapsnapshot path");
const data = await Bun.file(file).json();
const fields: string[] = data.snapshot.meta.node_fields;
const width = fields.length;
const typeAt = fields.indexOf("type"),
  nameAt = fields.indexOf("name"),
  sizeAt = fields.indexOf("self_size"),
  detachedAt = fields.indexOf("detachedness");
if (!width || [typeAt, nameAt, sizeAt].some((index) => index < 0))
  throw new Error("Unsupported heap snapshot schema");
const types: string[] = data.snapshot.meta.node_types[typeAt];
const groups = new Map<string, { count: number; bytes: number }>();
let total = 0,
  detached = 0;
for (let i = 0; i < data.nodes.length; i += width) {
  const type = types[data.nodes[i + typeAt]];
  const name = data.strings[data.nodes[i + nameAt]];
  const bytes = data.nodes[i + sizeAt];
  total += bytes;
  if (detachedAt >= 0 && data.nodes[i + detachedAt] === 2) detached++;
  const key = `${type}/${name}`;
  const group = groups.get(key) ?? { count: 0, bytes: 0 };
  group.count++;
  group.bytes += bytes;
  groups.set(key, group);
}
console.log(
  JSON.stringify(
    {
      file,
      nodeCount: data.snapshot.node_count,
      totalSelfBytes: total,
      detached,
      largest: [...groups]
        .map(([name, value]) => ({ name, ...value }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 30),
      objectGroups: [...groups]
        .filter(
          ([name]) => name.startsWith("object/") || name.startsWith("native/"),
        )
        .map(([name, value]) => ({ name, ...value })),
      gameObjects: [...groups]
        .filter(([name]) =>
          /\/(ServerClock|Prediction|Interpolation|Simulation|View|TimingLog|Mesh|Scene|WebGLRenderer|HTMLDivElement|WebSocket|KinematicCharacterController)$/.test(
            name,
          ),
        )
        .map(([name, value]) => ({ name, ...value })),
    },
    null,
    2,
  ),
);
