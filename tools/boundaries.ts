import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
for (const folder of [
  "packages/simulation/src",
  "packages/protocol/src",
  "apps/client/src",
]) {
  for await (const path of new Bun.Glob("**/*.ts").scan({
    cwd: resolve(root, folder),
    absolute: true,
  })) {
    const source = await Bun.file(path).text();
    const imports = [
      ...source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)/g),
    ].map((match) => match[1]!);
    if (
      imports.some((name) => /bun:|node:|apps\/server|@derp\/server/.test(name))
    )
      throw new Error(`Server dependency in ${path}`);
    if (
      folder.startsWith("packages/") &&
      (/\b(?:document|window|Bun|WebSocket)\b/.test(source) ||
        imports.some((name) => name === "three"))
    )
      throw new Error(`Runtime dependency in ${path}`);
  }
}
console.log("Package boundaries passed");
