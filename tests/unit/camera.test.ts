import { expect, test } from "bun:test";
import {
  cameraBounds,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../../apps/client/src/camera";
import { pointerToWorld } from "../../apps/client/src/input";

const central = { left: -12, right: 12, bottom: 0, top: 13.5 };

test("camera centers on the player and restores the original view", () => {
  expect(cameraBounds()).toEqual(central);
  expect(VIEW_WIDTH).toBe(24);
  expect(VIEW_HEIGHT).toBe(13.5);
  const followed = cameraBounds({ x: 3, y: 10 });
  expect(followed).toEqual({ left: -9, right: 15, bottom: 3.25, top: 16.75 });
  expect(followed.right - followed.left).toBe(VIEW_WIDTH);
  expect(followed.top - followed.bottom).toBe(VIEW_HEIGHT);
});

test("camera center clamps at every world edge", () => {
  expect(cameraBounds({ x: -100, y: 10 })).toMatchObject({
    left: -36,
    right: -12,
  });
  expect(cameraBounds({ x: 100, y: 10 })).toMatchObject({
    left: 12,
    right: 36,
  });
  expect(cameraBounds({ x: 0, y: -10 })).toMatchObject({
    bottom: 0,
    top: 13.5,
  });
  expect(cameraBounds({ x: 0, y: 100 })).toMatchObject({
    bottom: 13.5,
    top: 27,
  });
  expect(cameraBounds({ x: 80, y: 40 })).toEqual({
    left: 12,
    right: 36,
    bottom: 13.5,
    top: 27,
  });
  expect(cameraBounds({ x: -80, y: -5 })).toEqual({
    left: -36,
    right: -12,
    bottom: 0,
    top: 13.5,
  });
});

test("pointer mapping follows camera bounds at more than one canvas size", () => {
  const small = { left: 10, top: 20, width: 640, height: 360 };
  const large = { left: 0, top: 0, width: 1920, height: 1080 };
  const shifted = cameraBounds({ x: 8, y: 12 });
  for (const rect of [small, large]) {
    expect(pointerToWorld(rect.left, rect.top, rect, shifted)).toEqual({
      x: shifted.left,
      y: shifted.top,
    });
    expect(
      pointerToWorld(
        rect.left + rect.width,
        rect.top + rect.height,
        rect,
        shifted,
      ),
    ).toEqual({ x: shifted.right, y: shifted.bottom });
    expect(
      pointerToWorld(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect,
        shifted,
      ),
    ).toEqual({
      x: (shifted.left + shifted.right) / 2,
      y: (shifted.bottom + shifted.top) / 2,
    });
  }
  const corner = pointerToWorld(10, 20, small, central)!;
  expect(pointerToWorld(0, 0, large, shifted)!.x - corner.x).toBeCloseTo(
    shifted.left - central.left,
    8,
  );
  expect(pointerToWorld(10, 20, small, shifted)!.y - corner.y).toBeCloseTo(
    shifted.top - central.top,
    8,
  );
});
