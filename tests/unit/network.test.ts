import { expect, test } from "bun:test";
import { DelayQueue } from "../../apps/client/src/network";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("jitter preserves command order, preset clearing cancels old callbacks", async () => {
  const delivered: number[] = [];
  const queue = new DelayQueue("routine", () => {
    throw new Error("Unexpected overflow");
  });
  try {
    for (let i = 0; i < 24; i++) queue.enqueue(() => delivered.push(i));
    await delay(100);
    expect(delivered).toEqual(Array.from({ length: 24 }, (_, i) => i));
    queue.enqueue(() => delivered.push(-1));
    queue.clear();
    queue.preset = "local";
    queue.enqueue(() => delivered.push(24));
    await delay(100);
    expect(delivered).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(queue.size).toBe(0);
  } finally {
    queue.clear();
  }
});

test("delayed-input flood cannot retain unbounded work or execute old commands", async () => {
  let overflows = 0,
    delivered = 0;
  const queue = new DelayQueue("degraded", () => overflows++);
  try {
    for (let i = 0; i < 257; i++) queue.enqueue(() => delivered++);
    expect(overflows).toBe(1);
    expect(queue.size).toBe(0);
    await delay(150);
    expect(delivered).toBe(0);
  } finally {
    queue.clear();
  }
});
