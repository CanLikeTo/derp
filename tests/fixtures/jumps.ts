import {
  CONTENT_VERSION,
  TRACE_VERSION,
  spawnState,
  NEUTRAL,
  type Trace,
  type Input,
} from "@derp/simulation";
// Pure traces run identically in Bun and test-only browser fixtures.
export function jumpTraces(): Record<string, Trace> {
  const trace = (
    initial: Partial<Trace["initial"]>,
    inputs: Input[],
  ): Trace => ({
    version: TRACE_VERSION,
    contentVersion: CONTENT_VERSION,
    initial: { ...spawnState("jump-fixture", 2), ...initial },
    inputs,
  });
  const press = { ...NEUTRAL, jumpPressed: true };
  const neutral = (n: number) =>
    Array.from({ length: n }, () => ({ ...NEUTRAL }));
  return {
    // Right edge of the left platform: horizontal sweep leaves its support at W.
    coyoteLast: trace({ x: -1.59, y: 2.4101, grounded: true }, [
      { moveX: 1, jumpPressed: false },
      ...neutral(5),
      press,
    ]),
    coyoteExpired: trace({ x: -1.59, y: 2.4101, grounded: true }, [
      { moveX: 1, jumpPressed: false },
      ...neutral(6),
      press,
    ]),
    landingNow: trace({ y: 1, vy: -10 }, [press, ...neutral(90)]),
    landingLast: trace({ y: 2, vy: -10 }, [press, ...neutral(90)]),
    landingExpired: trace({ y: 2.25, vy: -10 }, [press, ...neutral(90)]),
    secondAirPress: trace({ y: 0.9101, grounded: true }, [
      press,
      press,
      ...neutral(90),
    ]),
    ceiling: trace({ x: -8, y: 0.9101, grounded: true }, [
      press,
      ...neutral(90),
    ]),
    wall: trace(
      { x: 5.4101, y: 2.8 },
      Array.from({ length: 60 }, () => ({ moveX: -1, jumpPressed: false })),
    ),
  };
}
