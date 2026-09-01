import type { Page } from "@playwright/test";
import { resolve } from "node:path";

// Explicitly opt-in instrumentation of test-owned Chromium pages. Collection
// can stall frames, so profile runs are labelled and all timing samples retained.
export async function heapProfile(
  page: Page,
  directory: string,
  label: string,
  snapshot: boolean,
) {
  const session = await page.context().newCDPSession(page);
  const writer = snapshot
    ? Bun.file(resolve(directory, `${label}.heapsnapshot`)).writer()
    : undefined;
  try {
    if (writer)
      session.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) =>
        writer.write(chunk),
      );
    await session.send("HeapProfiler.collectGarbage");
    const heap = await session.send("Runtime.getHeapUsage");
    const dom = await session.send("Memory.getDOMCounters");
    if (writer)
      await session.send("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
      });
    return { label, at: new Date().toISOString(), heap, dom };
  } finally {
    await writer?.end();
    await session.detach();
  }
}
