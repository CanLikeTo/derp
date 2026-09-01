import type { Input } from "@derp/simulation";
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
  sample(): Input {
    const left = this.held.has("KeyA") || this.held.has("ArrowLeft");
    const right = this.held.has("KeyD") || this.held.has("ArrowRight");
    const input: Input = {
      moveX: left === right ? 0 : left ? -1 : 1,
      jumpPressed: this.jump,
      jetHeld: this.held.has("ShiftLeft") || this.held.has("ShiftRight"),
    };
    this.jump = false;
    return input;
  }
}
