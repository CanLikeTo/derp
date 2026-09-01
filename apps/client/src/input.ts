import {
  AIM_DEAD_ZONE,
  aimQFromVector,
  type Input,
  type PlayerState,
} from "@derp/simulation";

export type WorldPoint = { x: number; y: number };

export function pointerToWorld(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): WorldPoint | undefined {
  if (rect.width <= 0 || rect.height <= 0) return;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  return { x: -12 + 24 * u, y: 13.5 - 13.5 * v };
}

export class PointerAim {
  private point: { clientX: number; clientY: number } | undefined;
  update(clientX: number, clientY: number) {
    this.point = { clientX, clientY };
  }
  clear() {
    this.point = undefined;
  }
  target(canvas: HTMLCanvasElement): WorldPoint | undefined {
    if (!this.point) return;
    return pointerToWorld(
      this.point.clientX,
      this.point.clientY,
      canvas.getBoundingClientRect(),
    );
  }
  sample(state: PlayerState, target: WorldPoint | undefined) {
    if (!target) return { aimQ: state.aimQ, reticleVisible: false };
    const dx = target.x - state.x;
    const dy = target.y - state.y;
    if (Math.hypot(dx, dy) < AIM_DEAD_ZONE)
      return { aimQ: state.aimQ, reticleVisible: false };
    return { aimQ: aimQFromVector(dx, dy), reticleVisible: true };
  }
  get valid() {
    return !!this.point;
  }
}
export class Controls {
  private held = new Set<string>();
  private jump = false;
  press(code: string, repeat = false) {
    if (repeat || this.held.has(code)) return;
    this.held.add(code);
    if (code === "Space") this.jump = true;
  }
  release(code: string) {
    this.held.delete(code);
  }
  clear() {
    this.held.clear();
    this.jump = false;
  }
  sample(aimQ = 0): Input {
    const left = this.held.has("KeyA") || this.held.has("ArrowLeft");
    const right = this.held.has("KeyD") || this.held.has("ArrowRight");
    const input: Input = {
      moveX: left === right ? 0 : left ? -1 : 1,
      jumpPressed: this.jump,
      jetHeld: this.held.has("ShiftLeft") || this.held.has("ShiftRight"),
      aimQ,
    };
    this.jump = false;
    return input;
  }
}
