export const PRESETS = {
  local: { delay: 0, jitter: 0 },
  routine: { delay: 50, jitter: 10 },
  degraded: { delay: 100, jitter: 20 },
} as const;
export type Preset = keyof typeof PRESETS;
export class DelayQueue {
  private queue: { due: number; run: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seed = 731;
  constructor(
    public preset: Preset,
    private overflow: () => void,
    private delayed?: (lateness: number) => void,
  ) {}
  get size() {
    return this.queue.length;
  }
  enqueue(run: () => void) {
    if (this.queue.length >= 256) {
      this.clear();
      this.overflow();
      return;
    }
    const config = PRESETS[this.preset];
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    const jitter = ((this.seed / 0x100000000) * 2 - 1) * config.jitter;
    const due = Math.max(
      performance.now() + config.delay + jitter,
      this.queue.at(-1)?.due ?? 0,
    );
    this.queue.push({ due, run });
    this.schedule();
  }
  private schedule() {
    if (this.timer !== undefined || !this.queue.length) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        const now = performance.now();
        while (this.queue[0] && this.queue[0].due <= now + 0.5) {
          const entry = this.queue.shift()!;
          this.delayed?.(Math.max(0, performance.now() - entry.due));
          entry.run();
        }
        this.schedule();
      },
      Math.max(0, this.queue[0]!.due - performance.now()),
    );
  }
  clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
    this.seed = 731;
  }
}
