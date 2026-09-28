import { ROOM } from "@derp/simulation";

export const VIEW_WIDTH = 24;
export const VIEW_HEIGHT = 13.5;

export type CameraBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

const HALF_WIDTH = VIEW_WIDTH / 2;
const HALF_HEIGHT = VIEW_HEIGHT / 2;
const WORLD_LEFT = -ROOM.width / 2;
const WORLD_RIGHT = ROOM.width / 2;
const WORLD_BOTTOM = 0;
const WORLD_TOP = ROOM.height;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** World rectangle shown by the fixed-size view. Absent player restores the original central frame. */
export function cameraBounds(position?: {
  x: number;
  y: number;
}): CameraBounds {
  if (!position)
    return {
      left: -HALF_WIDTH,
      right: HALF_WIDTH,
      bottom: WORLD_BOTTOM,
      top: VIEW_HEIGHT,
    };
  const x = clamp(
    position.x,
    WORLD_LEFT + HALF_WIDTH,
    WORLD_RIGHT - HALF_WIDTH,
  );
  const y = clamp(
    position.y,
    WORLD_BOTTOM + HALF_HEIGHT,
    WORLD_TOP - HALF_HEIGHT,
  );
  return {
    left: x - HALF_WIDTH,
    right: x + HALF_WIDTH,
    bottom: y - HALF_HEIGHT,
    top: y + HALF_HEIGHT,
  };
}
