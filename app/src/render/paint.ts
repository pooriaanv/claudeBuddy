// port of Sources/ClaudeBuddy/Render/Paint.swift (Mac reference v0.0.9)
//
// Swift `GraphicsContext` is a value type: `var g = ctx; g.translateBy(...)` changes only the copy.
// `CanvasRenderingContext2D` is a shared mutable object, so every such copy becomes `ctx.save()` ... `ctx.restore()`
// in the caller. Helpers that Swift writes as "returns a transformed copy" (`rotated`, `Paint.head`) apply the
// transform to the context they are given; call them between `save()` and `restore()`.
//
// Every helper that strokes sets all stroke properties it relies on (cap, join, miter limit), so no state leaks
// from one call into the next.

import type { Point, Pose, Size } from "../core/pose";

// ---------------------------------------------------------------------------------------------------------------
// Color: SwiftUI `Color(red:green:blue:)` with components 0...1, kept exactly; converted to CSS (x255) when used.
// ---------------------------------------------------------------------------------------------------------------

export class Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  private cached: string | null = null;

  constructor(r: number, g: number, b: number, a = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  /// SwiftUI `Color.opacity(_:)` (multiplies the current alpha).
  opacity(a: number): Color {
    return new Color(this.r, this.g, this.b, this.a * a);
  }

  /// `rgba(r*255, g*255, b*255, a)` with the exact (unrounded) components.
  get css(): string {
    if (this.cached === null) {
      this.cached = `rgba(${this.r * 255}, ${this.g * 255}, ${this.b * 255}, ${this.a})`;
    }
    return this.cached;
  }
}

/// SwiftUI `Color(red:green:blue:)`.
export function rgb(r: number, g: number, b: number): Color {
  return new Color(r, g, b);
}

/// SwiftUI `Color.white` / `Color.black`.
export const WHITE = new Color(1, 1, 1);
export const BLACK = new Color(0, 0, 0);

export const Palette = {
  ink: rgb(0.17, 0.15, 0.2),
  blush: rgb(1.0, 0.52, 0.58),
  heart: rgb(1.0, 0.36, 0.54),
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------------------------

export function pt(x: number, y: number): Point {
  return { x, y };
}

/// `Path(ellipseIn: CGRect(x: c.x - w/2, y: c.y - h/2, width: w, height: h))`. `w`/`h` are the FULL width/height.
export function ellipse(c: Point, w: number, h: number): Path2D {
  const p = new Path2D();
  p.ellipse(c.x, c.y, w / 2, h / 2, 0, 0, Math.PI * 2);
  p.closePath(); // SwiftUI's ellipse path is closed; matters for the stroke join
  return p;
}

export function circle(c: Point, d: number): Path2D {
  return ellipse(c, d, d);
}

/// `Path(roundedRect: CGRect(x:y:width:height:), cornerRadius: r)`.
export function roundedRect(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// GraphicsContext extension
// ---------------------------------------------------------------------------------------------------------------

/// `GraphicsContext.fill(_:_:edge:width:)`: fills, then strokes the same path with the edge color (default width 2).
/// The edge uses SwiftUI's default stroke style (butt caps, miter joins, miter limit 10).
export function fill(ctx: CanvasRenderingContext2D, path: Path2D, color: Color, edge?: Color, width = 2): void {
  ctx.fillStyle = color.css;
  ctx.fill(path);
  if (edge !== undefined) {
    ctx.strokeStyle = edge.css;
    ctx.lineWidth = width;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.miterLimit = 10;
    ctx.stroke(path);
  }
}

/// `GraphicsContext.line(_:_:_:)`: round caps and joins.
export function line(ctx: CanvasRenderingContext2D, path: Path2D, color: Color, width: number): void {
  ctx.strokeStyle = color.css;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path);
}

/// `GraphicsContext.rotated(_:around:)`: rotates by `degrees` around `pivot`. Mutates `ctx` (call inside save/restore).
export function rotated(ctx: CanvasRenderingContext2D, degrees: number, pivot: Point): void {
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.translate(-pivot.x, -pivot.y);
}

/// `Path(CGRect(x:y:width:height:))`.
export function rectPath(x: number, y: number, w: number, h: number): Path2D {
  const p = new Path2D();
  p.rect(x, y, w, h);
  return p;
}

/// `GraphicsContext.stroke(path, with: .color(c), lineWidth: w)`: SwiftUI's default `StrokeStyle` (butt caps, miter
/// joins, miter limit 10).
export function stroke(ctx: CanvasRenderingContext2D, path: Path2D, color: Color, width: number): void {
  ctx.strokeStyle = color.css;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  ctx.stroke(path);
}

/// Current uniform scale of the context (device pixels per user unit), e.g. dpr x design scale.
export function currentScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

/// `addFilter(.blur(radius: r))`: canvas filter lengths are in device pixels, SwiftUI's radius is in user units, so the
/// radius is multiplied by the current scale. Mutates `ctx` (call inside save/restore).
export function addBlur(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.filter = `blur(${radius * currentScale(ctx)}px)`;
}

const layerPool: Array<HTMLCanvasElement | OffscreenCanvas> = [];
let layerDepth = 0;

/// `drawLayer { ... }` composited with the context's current opacity (04-rendering.md: "draw into an OffscreenCanvas,
/// then drawImage with globalAlpha - otherwise overlapping parts show through"). `body` receives a fresh context with
/// the same transform; it is composited back at the caller's `globalAlpha`. Use inside save/restore:
///   ctx.save(); ctx.globalAlpha = x; drawLayer(ctx, (l) => { ... }); ctx.restore();
/// Layers may nest (one pooled canvas per depth).
export function drawLayer(ctx: CanvasRenderingContext2D, body: (layer: CanvasRenderingContext2D) => void): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  let canvas = layerPool[layerDepth];
  if (canvas === undefined || canvas.width !== w || canvas.height !== h) {
    canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    layerPool[layerDepth] = canvas;
  }
  const layer = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (layer === null) throw new Error("2d context unavailable");
  layer.reset(); // clears the bitmap and every state (transform, alpha, filter, clip, save stack)
  layer.setTransform(ctx.getTransform());
  layerDepth++;
  try {
    body(layer);
  } finally {
    layerDepth--;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------------------------------------------

/// What's at the end of an arm.
export type Hand = { kind: "fist" } | { kind: "paw"; pad: Color } | { kind: "robot" };

export interface Limb {
  fill: Color;
  edge: Color;
  width: number;
  handSize: number;
  handFill: Color;
  handEdge: Color;
  hand: Hand;
}

// ---------------------------------------------------------------------------------------------------------------
// enum Paint
// ---------------------------------------------------------------------------------------------------------------

function armEnd(shoulder: Point, angle: number, length: number): Point {
  const a = (angle * Math.PI) / 180;
  return pt(shoulder.x - length * Math.sin(a), shoulder.y + length * Math.cos(a));
}

/// Draws an arm hanging from `shoulder`, rotated by `angle` (0 = straight down). `press` > 1 squashes the hand on the glass.
function limb(
  ctx: CanvasRenderingContext2D,
  l: Limb,
  shoulder: Point,
  angle: number,
  length: number,
  press = 1,
): void {
  ctx.save();
  ctx.translate(shoulder.x, shoulder.y);
  ctx.rotate((angle * Math.PI) / 180);
  const w = l.width;
  const arm = roundedRect(-w / 2, -6, w, length + 4, w / 2);
  fill(ctx, arm, l.fill, l.edge, 1.8);
  const d = l.handSize * press;
  const c = pt(0, length);
  fill(ctx, circle(c, d), l.handFill, l.handEdge, 1.6);
  if (press > 1.05) {
    switch (l.hand.kind) {
      case "fist":
        for (const dx of [-0.22, 0.0, 0.22]) {
          const p = new Path2D();
          p.moveTo(c.x + dx * d - d * 0.08, c.y - d * 0.18);
          p.lineTo(c.x + dx * d + d * 0.08, c.y - d * 0.18);
          line(ctx, p, l.handEdge, 1.6);
        }
        break;
      case "paw":
        beans(ctx, c, d, l.hand.pad);
        break;
      case "robot":
        fill(ctx, circle(c, d * 0.45), rgb(0.4, 0.95, 0.89).opacity(0.85));
        break;
    }
  }
  ctx.restore();
}

/// Toe beans squished on the glass.
function beans(ctx: CanvasRenderingContext2D, c: Point, d: number, pad: Color): void {
  fill(ctx, ellipse(pt(c.x, c.y + d * 0.1), d * 0.42, d * 0.34), pad);
  for (const [dx, dy] of [
    [-0.27, -0.2],
    [0.0, -0.3],
    [0.27, -0.2],
  ] as const) {
    fill(ctx, circle(pt(c.x + dx * d, c.y + dy * d), d * 0.17), pad);
  }
}

/// Transform for the head: tilts around `pivot` and bobs. Mutates `ctx` (call inside save/restore).
function head(ctx: CanvasRenderingContext2D, pose: Pose, pivot: Point): void {
  rotated(ctx, pose.headTilt, pivot);
  ctx.translate(0, pose.headOffset);
}

/// Cartoon eyes for every mood. `centers` are already shifted for head turn.
function eyes(
  ctx: CanvasRenderingContext2D,
  centers: Point[],
  size: Size,
  pose: Pose,
  color: Color = Palette.ink,
): void {
  for (const c0 of centers) {
    const c = pt(c0.x + pose.look.x * 3, c0.y + pose.look.y * 2);
    const w = size.width;
    const h = size.height;
    if (pose.mood === "happy") {
      const p = new Path2D();
      p.moveTo(c.x - w * 0.5, c.y + 3);
      p.quadraticCurveTo(c.x, c.y - h * 0.55, c.x + w * 0.5, c.y + 3);
      line(ctx, p, color, 3.5);
    } else if (pose.mood === "sleepy" && pose.eyeOpen < 0.35) {
      const p = new Path2D();
      p.moveTo(c.x - w * 0.5, c.y);
      p.quadraticCurveTo(c.x, c.y + h * 0.35, c.x + w * 0.5, c.y);
      line(ctx, p, color, 3);
    } else if (pose.mood === "surprised") {
      fill(ctx, circle(c, w * 0.8), color);
      fill(ctx, circle(pt(c.x - 2.5, c.y - 3), 5), WHITE);
    } else {
      const scale = pose.mood === "excited" ? 1.18 : 1;
      const ew = w * scale;
      const eh = Math.max(2.5, h * scale * pose.eyeOpen);
      fill(ctx, ellipse(c, ew, eh), color);
      if (pose.eyeOpen > 0.5) {
        fill(ctx, circle(pt(c.x - ew * 0.18, c.y - eh * 0.22), ew * 0.36), WHITE);
        fill(ctx, circle(pt(c.x + ew * 0.2, c.y + eh * 0.2), ew * 0.18), WHITE.opacity(0.9));
      }
    }
  }
}

function mouth(ctx: CanvasRenderingContext2D, c: Point, pose: Pose, width = 20, color: Color = Palette.ink): void {
  switch (pose.mouth) {
    case "smile": {
      const m = new Path2D();
      m.moveTo(c.x - width / 2, c.y - 2);
      m.quadraticCurveTo(c.x, c.y + width * 0.5, c.x + width / 2, c.y - 2);
      line(ctx, m, color, 3);
      break;
    }
    case "small": {
      const m = new Path2D();
      m.moveTo(c.x - width * 0.25, c.y);
      m.quadraticCurveTo(c.x, c.y + 3, c.x + width * 0.25, c.y);
      line(ctx, m, color, 2.5);
      break;
    }
    case "grin": {
      const m = new Path2D();
      m.moveTo(c.x - width * 0.65, c.y - 4);
      m.lineTo(c.x + width * 0.65, c.y - 4);
      m.quadraticCurveTo(c.x, c.y + width * 1.1, c.x - width * 0.65, c.y - 4);
      m.closePath();
      fill(ctx, m, color);
      ctx.save(); // `var tongue = ctx; tongue.clip(to: m)`
      ctx.clip(m);
      fill(ctx, ellipse(pt(c.x, c.y + width * 0.5), width * 0.7, width * 0.45), Palette.blush);
      ctx.restore();
      break;
    }
    case "o": {
      const s = pose.mouthOpen;
      fill(ctx, ellipse(pt(c.x, c.y + 3), width * 0.5 * (0.7 + s * 0.3), width * 0.45 * (0.5 + s * 0.7)), color);
      break;
    }
  }
}

function blush(ctx: CanvasRenderingContext2D, centers: Point[], size: Size, pose: Pose): void {
  const alpha = pose.mood === "excited" || pose.mood === "happy" ? 0.75 : 0.5;
  for (const c of centers) fill(ctx, ellipse(c, size.width, size.height), Palette.blush.opacity(alpha));
}

function sparkle(c: Point, r: number, inner: number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    const qx = c.x + Math.cos(a) * rr;
    const qy = c.y + Math.sin(a) * rr;
    if (i === 0) p.moveTo(qx, qy);
    else p.lineTo(qx, qy);
  }
  p.closePath();
  return p;
}

function heart(c: Point, s: number): Path2D {
  const p = new Path2D();
  p.moveTo(c.x, c.y + s * 0.35);
  p.bezierCurveTo(c.x - s * 0.1, c.y + s * 0.2, c.x - s * 0.5, c.y + s * 0.15, c.x - s * 0.5, c.y - s * 0.1);
  p.bezierCurveTo(c.x - s * 0.5, c.y - s * 0.45, c.x - s * 0.05, c.y - s * 0.45, c.x, c.y - s * 0.2);
  p.bezierCurveTo(c.x + s * 0.05, c.y - s * 0.45, c.x + s * 0.5, c.y - s * 0.45, c.x + s * 0.5, c.y - s * 0.1);
  p.bezierCurveTo(c.x + s * 0.5, c.y + s * 0.15, c.x + s * 0.1, c.y + s * 0.2, c.x, c.y + s * 0.35);
  return p;
}

export const Paint = { armEnd, limb, beans, head, eyes, mouth, blush, sparkle, heart };

/// Windows addition (Pooria, 2026-10-15): folded, crossed legs in front of the lower body for the meditation pose
/// (character space; drawn after the body, which the animator lowers with `lift`).
export function drawLotusLegs(c: CanvasRenderingContext2D, leg: Color, shoe: Color, edge?: Color): void {
  for (const side of [-1, 1]) {
    c.save();
    c.translate(100 + side * 22, 274);
    c.rotate((-side * 9 * Math.PI) / 180);
    fill(c, roundedRect(-34, -9, 68, 18, 9), leg, edge ?? shoe, 1.6);
    c.restore();
    fill(c, ellipse(pt(100 - side * 20, 279), 22, 11), shoe);
  }
}