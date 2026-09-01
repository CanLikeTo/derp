import { TICK_MS } from "@derp/simulation";

export function predictionLead(rtt: number, jitter: number) {
  return Math.max(2, Math.min(12, Math.ceil((rtt / 2 + jitter) / TICK_MS) + 2));
}

// Browser timers can run late even when the configured network delay is stable.
// Remember a bounded recent peak; the live lead itself never shrinks mid-epoch.
export class SchedulingJitter {
  private samples: number[] = [];
  observe(lateness: number) {
    this.samples.push(Math.max(0, Math.min(250, lateness)));
    if (this.samples.length > 120) this.samples.shift();
  }
  get allowance() {
    return Math.max(0, ...this.samples);
  }
  clear() {
    this.samples = [];
  }
}

// Ping midpoint estimates relate the two monotonic clocks; their absolute
// origins need not match. Prefer the least delayed of eight recent samples.
export class ServerClock {
  private samples: { rtt: number; offset: number }[] = [];
  private offset = 0;
  private anchorTick = 0;
  private anchorTime = 0;
  private lastAt = 0;
  private lastTick = 0;
  observe(serverTime: number, sentAt: number, receivedAt: number) {
    this.samples.push({
      rtt: receivedAt - sentAt,
      offset: serverTime - (sentAt + receivedAt) / 2,
    });
    if (this.samples.length > 8) this.samples.shift();
    this.offset = this.samples.reduce((best, sample) =>
      sample.rtt < best.rtt ? sample : best,
    ).offset;
  }
  baseline(tick: number, serverTime: number, now: number) {
    this.anchorTick = tick;
    this.anchorTime = serverTime;
    this.lastAt = now;
    this.lastTick =
      tick + Math.max(0, now + this.offset - serverTime) / TICK_MS;
    return this.lastTick;
  }
  tick(now: number) {
    const elapsed = Math.max(0, now - this.lastAt) / TICK_MS;
    const desired =
      this.anchorTick + (now + this.offset - this.anchorTime) / TICK_MS;
    const nominal = this.lastTick + elapsed;
    // Slew at 90–110% speed rather than stepping backwards or freezing input.
    this.lastTick =
      nominal +
      Math.max(-elapsed * 0.1, Math.min(elapsed * 0.1, desired - nominal));
    this.lastAt = now;
    return this.lastTick;
  }
  clear() {
    this.samples = [];
    this.offset = 0;
    this.anchorTick = this.anchorTime = this.lastAt = this.lastTick = 0;
  }
}

// All timestamps in this log are local to the recording process. Correlate
// browser/server records by identity, epoch and tick, never by clock subtraction.
export class TimingLog {
  private sequence = 0;
  records: Record<string, string | number>[] = [];
  add(record: Record<string, string | number>) {
    this.records.push({ ...record, sequence: ++this.sequence });
    if (this.records.length > 2400) this.records.shift();
  }
}
