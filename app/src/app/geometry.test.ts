import { describe, expect, it } from "vitest";
import {
  alertFrame,
  alertScreen,
  animationRect,
  defaultCenterX,
  ease,
  floorScreen,
  headCenter,
  idleFrame,
  primaryMonitor,
} from "./geometry";
import type { MonitorInfo } from "./geometry";

// The dev machine: 3440x1440 at 100 %, taskbar 48 px at the bottom -> work area 3440x1392.
const dev: MonitorInfo = { x: 0, y: 0, width: 3440, height: 1440, workArea: { x: 0, y: 0, width: 3440, height: 1392 }, scale: 1 };
const second: MonitorInfo = { x: 3440, y: 0, width: 1920, height: 1080, workArea: { x: 3440, y: 0, width: 1920, height: 1040 }, scale: 1.5 };

describe("geometry (physical px, y down)", () => {
  it("idleFrame on the dev machine equals the Rust idle_frame / P0 numbers", () => {
    const f = idleFrame([dev], 150, defaultCenterX([dev]));
    expect(defaultCenterX([dev])).toBe(3320);
    expect(f).toEqual({ x: 3245, y: 1199, w: 150, h: 200 });
    expect(f.y + f.h).toBe(1392 + 7); // window bottom 3.5 % below the work area
  });

  it("idleFrame scales the size with the monitor and sinks round(0.035 h)", () => {
    const m: MonitorInfo = { ...dev, width: 2560, workArea: { x: 0, y: 0, width: 2560, height: 1360 }, scale: 1.5 };
    const f = idleFrame([m], 150, defaultCenterX([m]));
    expect([f.w, f.h]).toEqual([225, 300]);
    expect(f.y + f.h).toBe(1360 + 11);
    expect(Math.abs(f.x + f.w / 2 - (2560 - 180))).toBeLessThanOrEqual(1);
  });

  it("idleFrame clamps centerX into the work area", () => {
    const m: MonitorInfo = { ...dev, x: 100, width: 1000, workArea: { x: 100, y: 0, width: 1000, height: 800 } };
    expect(idleFrame([m], 150, 100 - 500).x).toBe(100); // outside every monitor: the primary fallback, clamped left
    expect(idleFrame([m], 150, 100 + 5000).x + 150).toBe(1100);
  });

  it("floorScreen picks the monitor whose x range holds centerX, else the primary one", () => {
    expect(floorScreen([second, dev], 100)).toBe(dev);
    expect(floorScreen([dev, second], 4000)).toBe(second);
    expect(floorScreen([dev, second], 3440)).toBe(second); // right edge is exclusive
    expect(floorScreen([second, dev], -50)).toBe(dev);
    expect(primaryMonitor([second, dev])).toBe(dev);
  });

  it("alertFrame: h = min(66 % of the work-area height, 576 pt), centered in the work area", () => {
    expect(alertFrame(dev)).toEqual({ x: 1720 - 216, y: 696 - 288, w: 432, h: 576 });
    const small: MonitorInfo = { ...dev, workArea: { x: 0, y: 0, width: 1280, height: 600 } };
    const f = alertFrame(small);
    expect(f.h).toBeCloseTo(396, 6);
    expect(f.w).toBeCloseTo(297, 6);
    expect(f.x).toBeCloseTo(640 - 148.5, 6);
    // 576 pt at 150 % = 864 px, but only when the screen is tall enough
    const hi = alertFrame(second);
    expect(hi.h).toBeCloseTo(Math.min(1040 * 0.66, 864), 6);
  });

  it("alertScreen is the monitor under the cursor, else the primary one", () => {
    expect(alertScreen([dev, second], { x: 4000, y: 10 })).toBe(second);
    expect(alertScreen([dev, second], { x: 10, y: 10 })).toBe(dev);
    expect(alertScreen([dev, second], { x: -5, y: 10 })).toBe(dev);
  });

  it("headCenter is half way down the window (160 / 320)", () => {
    expect(headCenter({ x: 100, y: 200, w: 150, h: 200 })).toEqual({ x: 175, y: 300 });
  });

  it("ease: both curves start at 0 and end at 1; ease-out-back overshoots", () => {
    for (const o of [true, false]) {
      expect(ease(0, o)).toBeCloseTo(0, 12);
      expect(ease(1, o)).toBeCloseTo(1, 12);
    }
    expect(ease(0.5, false)).toBeCloseTo(0.5, 12);
    let max = 0;
    for (let x = 0; x <= 1; x += 0.01) max = Math.max(max, ease(x, true));
    expect(max).toBeGreaterThan(1.05);
  });

  it("animationRect: the hop lifts the window (smaller y) and the minimum size is 40 x 54 pt", () => {
    const a = { from: { x: 0, y: 1000, w: 150, h: 200 }, to: { x: 500, y: 400, w: 432, h: 576 }, hop: 80, scale: 1 };
    const mid = animationRect(a, 0.5, 0.5);
    expect(mid.y).toBeCloseTo(700 - 80, 9);
    expect(mid.x).toBe(250);
    expect(mid.w).toBe(291);
    const end = animationRect(a, 1, 1);
    expect(end.x).toBe(500);
    expect(end.y).toBeCloseTo(400, 9);
    const tiny = animationRect({ ...a, from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 }, scale: 2 }, 0, 0);
    expect([tiny.w, tiny.h]).toEqual([80, 108]);
  });
});
