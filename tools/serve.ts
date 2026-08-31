import { resolve } from "node:path";
const mode = process.argv[2] ?? "dev";
if (mode !== "dev" && mode !== "preview")
  throw new Error("Expected dev or preview");
const root = resolve(import.meta.dir, "..");
const children: ReturnType<typeof Bun.spawn>[] = [];
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const forced = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 2000);
  await Promise.all(children.map((child) => child.exited));
  clearTimeout(forced);
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void stop(0));
const commands = [
  [
    process.execPath,
    mode === "dev" ? "apps/server/src/main.ts" : "dist/server/main.js",
  ],
  [
    process.execPath,
    "node_modules/vite/bin/vite.js",
    ...(mode === "preview" ? ["preview"] : []),
    "--config",
    "apps/client/vite.config.ts",
  ],
];
for (const cmd of commands) {
  const child = Bun.spawn(cmd, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    // Keep the pipe open: Vite treats stdin EOF as a shutdown request outside CI.
    // This supervisor owns process lifetime and forwards termination explicitly.
    stdin: "pipe",
  });
  children.push(child);
  child.exited.then((code) => {
    if (!stopping) void stop(code === 0 ? 1 : code);
  });
}
await new Promise(() => {});
