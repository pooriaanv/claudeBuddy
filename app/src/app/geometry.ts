// Pet window geometry in GLOBAL PHYSICAL PIXELS, y axis pointing DOWN (12-windows-plan.md D5).
// Mac constants are points: px = pt * monitor.scale. Pure functions, unit-tested (geometry.test.ts).

import type { Point } from "../core/pose";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RectDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

/// What the Rust `monitors()` command returns (physical px).
export interface MonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  workArea: RectDto;
  scale: number;
}

/// Mac `SceneRenderer.design`: the window's aspect (240 x 320).
export const DESIGN_WIDTH = 240;
export const DESIGN_HEIGHT = 320;
/// Mac `idleFrame`: the window bottom sits `h * 0.035` below the floor (the work-area bottom).
export const FLOOR_SINK = 0.035;
/// Mac `PetController.init`: default `centerX = visibleFrame.maxX - 120` (pt).
export const DEFAULT_CENTER_X_INSET_PT = 120;
/// Mac `alertFrame`: `h = min(visibleFrame.height * 0.66, 576)` (pt).
export const ALERT_HEIGHT_FRACTION = 0.66;
export const ALERT_MAX_HEIGHT_PT = 576;
/// Mac `stepAnimation`: smallest window while animating (pt).
export const MIN_ANIMATION_WIDTH_PT = 40;
export const MIN_ANIMATION_HEIGHT_PT = 54;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

export function workAreaOf(m: MonitorInfo): Rect {
  return { x: m.workArea.x, y: m.workArea.y, w: m.workArea.width, h: m.workArea.height };
}

/// Windows' primary monitor always has its top-left at (0, 0); first one as a fallback.
export function primaryMonitor(monitors: readonly MonitorInfo[]): MonitorInfo {
  const m = monitors.find((c) => c.x === 0 && c.y === 0) ?? monitors[0];
  if (m === undefined) throw new Error("no monitors");
  return m;
}

/// port of `PetController.floorScreen`: the screen whose x range holds `centerX` (else the main screen).
export function floorScreen(monitors: readonly MonitorInfo[], centerX: number): MonitorInfo {
  return monitors.find((m) => m.x <= centerX && centerX < m.x + m.width) ?? primaryMonitor(monitors);
}

/// Default `centerX` (no saved `petX`): the main screen's work-area right edge minus 120 pt.
export function defaultCenterX(monitors: readonly MonitorInfo[]): number {
  const m = primaryMonitor(monitors);
  return m.workArea.x + m.workArea.width - DEFAULT_CENTER_X_INSET_PT * m.scale;
}

/// port of `PetController.idleFrame`: on the floor (just above the taskbar) at `centerX`.
/// Same arithmetic as the Rust `geometry::idle_frame`: `w = round(size_pt * scale)`, `h = round(w * 320 / 240)`,
/// `y = wa.bottom + round(h * 0.035) - h` (Mac's y points up).
export function idleFrame(monitors: readonly MonitorInfo[], sizePt: number, centerX: number): Rect {
  const m = floorScreen(monitors, centerX);
  const wa = workAreaOf(m);
  const w = Math.round(sizePt * m.scale);
  const h = Math.round((w * DESIGN_HEIGHT) / DESIGN_WIDTH);
  const half = w / 2;
  const x = Math.min(wa.x + wa.w - half, Math.max(wa.x + half, centerX));
  return { x: Math.round(x - half), y: wa.y + wa.h + Math.round(h * FLOOR_SINK) - h, w, h };
}

/// The screen under the cursor (`NSMouseInRect(mouse, screen.frame, false)`), else the main screen.
export function alertScreen(monitors: readonly MonitorInfo[], mouse: Point): MonitorInfo {
  return (
    monitors.find((m) => mouse.x >= m.x && mouse.x < m.x + m.width && mouse.y >= m.y && mouse.y < m.y + m.height) ??
    primaryMonitor(monitors)
  );
}

/// port of `PetController.alertFrame`: big and centered in the work area of the screen with the cursor.
export function alertFrame(m: MonitorInfo): Rect {
  const wa = workAreaOf(m);
  const h = Math.min(wa.h * ALERT_HEIGHT_FRACTION, ALERT_MAX_HEIGHT_PT * m.scale);
  const w = (h * DESIGN_WIDTH) / DESIGN_HEIGHT;
  return { x: wa.x + wa.w / 2 - w / 2, y: wa.y + wa.h / 2 - h / 2, w, h };
}

/// port of `PetController.headCenter`: Mac `frame.maxY - h * 160 / 320` (y up) = `frame.y + h * 160 / 320` (y down).
export function headCenter(f: Rect): Point {
  return { x: f.x + f.w / 2, y: f.y + (f.h * 160) / 320 };
}

/// The easing of `stepAnimation`: ease-out-back (`overshoot`) or ease-in-out cubic. `x` in 0...1.
export function ease(x: number, overshoot: boolean): number {
  if (overshoot) {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export interface FrameAnimationShape {
  from: Rect;
  to: Rect;
  /// Hop height in points, `scale` converts it (and the minimum size) to px.
  hop: number;
  scale: number;
}

/// port of `PetController.stepAnimation` (frame part). Mac adds the hop to the y of an upward-pointing axis,
/// here it is subtracted: `y = from.y + (to.y - from.y) * k - sin(x * pi) * hop * scale`.
export function animationRect(a: FrameAnimationShape, x: number, k: number): Rect {
  const up = Math.sin(x * Math.PI) * a.hop * a.scale;
  return {
    x: a.from.x + (a.to.x - a.from.x) * k,
    y: a.from.y + (a.to.y - a.from.y) * k - up,
    w: Math.max(MIN_ANIMATION_WIDTH_PT * a.scale, a.from.w + (a.to.w - a.from.w) * k),
    h: Math.max(MIN_ANIMATION_HEIGHT_PT * a.scale, a.from.h + (a.to.h - a.from.h) * k),
  };
}
