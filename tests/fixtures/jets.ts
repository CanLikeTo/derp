import {
  CONTENT_VERSION,
  TRACE_VERSION,
  NEUTRAL,
  spawnState,
  type Input,
  type Trace,
} from "@derp/simulation";
export function jetTraces(): Record<string, Trace> {
  const trace = (
    initial: Partial<Trace["initial"]>,
    inputs: Input[],
    enabled = true,
  ): Trace => ({
    version: TRACE_VERSION,
    contentVersion: CONTENT_VERSION,
    rules: { jetsEnabled: enabled },
    initial: {
      ...spawnState("jet-fixture", 2),
      x: 8,
      y: 0.9101,
      grounded: true,
      ...initial,
    },
    inputs,
  });
  const held = (n: number) =>
    Array.from({ length: n }, () => ({ ...NEUTRAL, jetHeld: true }));
  const released = (n: number) =>
    Array.from({ length: n }, () => ({ ...NEUTRAL }));
  return {
    exhaust: trace({}, [...held(240), ...released(60)]),
    release: trace({}, [
      ...held(10),
      ...released(10),
      ...held(15),
      ...released(150),
    ]),
    combined: trace({}, [
      { ...NEUTRAL, jumpPressed: true, jetHeld: true },
      ...held(90),
      ...released(90),
    ]),
    coyote: trace(
      { x: -1.59, y: 2.4101, grounded: false, coyoteTicksRemaining: 1 },
      [{ ...NEUTRAL, jumpPressed: true, jetHeld: true }, ...held(50)],
    ),
    buffer: trace({ y: 1, vy: -10, grounded: false }, [
      { ...NEUTRAL, jumpPressed: true, jetHeld: true },
      ...held(50),
    ]),
    roof: trace({ y: 12.08, vy: 12, grounded: false }, held(80)),
    wall: trace(
      { x: 11.58, y: 5, grounded: false },
      Array.from({ length: 80 }, () => ({
        ...NEUTRAL,
        moveX: 1,
        jetHeld: true,
      })),
    ),
    releaseAtLedge: trace(
      {
        x: -1.59,
        y: 2.4101,
        grounded: true,
        vy: 0.25,
        jetActive: true,
        jetFuelTicksRemaining: 44,
      },
      [{ ...NEUTRAL, moveX: 1 }, ...released(30)],
    ),
    disabled: trace({}, [...held(45), ...released(60)], false),
  };
}
