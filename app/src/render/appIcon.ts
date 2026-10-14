// port of Sources/ClaudeBuddy/AppIcon.swift (Mac reference v0.0.9)
//
// The app icon (a kitten peeking over a window ledge) and the tray face, drawn with the same skins as the pet.
// `writeIconset` / `png` (NSImage + iconutil) have no counterpart here: the snapshot tool and the build script export
// PNGs from these two drawing functions.

import { Pose } from "../core/pose";
import type { SkinID } from "../core/pose";
import { Paint, WHITE, circle, ellipse, fill, line, pt, rgb } from "./paint";
import { skinFor } from "./skins/catalog";
import { KittySkin } from "./skins/kitty";

/// A rounded rectangle with Apple's continuous ("squircle") corners. The reference icon's tile is drawn with this curve,
/// not with circular arcs (the curve starts 1.5287 x radius away from the corner and blends in gradually). The numbers are
/// the well-known iOS 7 rounded-rect Bezier approximation; each corner is the same curve rotated by 90 degrees.
function continuousRoundedRect(x: number, y: number, w: number, h: number, radius: number): Path2D {
  const k = 1.52866483;
  const r = Math.min(radius, Math.min(w, h) / 2 / k);
  // corner point, direction of travel before the corner, direction of travel after it (clockwise from the top-left)
  const corners: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [x + w, y, 1, 0, 0, 1],
    [x + w, y + h, 0, 1, -1, 0],
    [x, y + h, -1, 0, 0, -1],
    [x, y, 0, -1, 1, 0],
  ];
  const p = new Path2D();
  // (a, b): a = distance back along the incoming edge, b = distance forward along the outgoing edge, in units of r.
  const at = (c: readonly number[], a: number, b: number): [number, number] => [
    c[0] + (b * c[4] - a * c[2]) * r,
    c[1] + (b * c[5] - a * c[3]) * r,
  ];
  const first = corners[3];
  p.moveTo(...at(first, 0, k));
  for (const c of corners) {
    p.lineTo(...at(c, 1.52866471, 0));
    p.bezierCurveTo(...at(c, 1.08849323, 0), ...at(c, 0.86840689, 0), ...at(c, 0.66993427, 0.065496));
    p.lineTo(...at(c, 0.63149399, 0.074911));
    p.bezierCurveTo(...at(c, 0.37282392, 0.16905899), ...at(c, 0.16905899, 0.37282392), ...at(c, 0.074911, 0.63149399));
    p.lineTo(...at(c, 0.065496, 0.66993493));
    p.bezierCurveTo(...at(c, 0, 0.86840701), ...at(c, 0, 1.08849296), ...at(c, 0, k));
  }
  p.closePath();
  return p;
}

/// Swift `AppIcon.drawIcon(_:size:)`: draws the icon in a 1024×1024 space (Apple's grid: an 824pt rounded square in
/// the middle), scaled into a size×size area at the context's origin.
// port of AppIcon.drawIcon
export function drawIcon(ctx: CanvasRenderingContext2D, size: number): void {
  const k = size / 1024;
  ctx.save();
  ctx.scale(k, k);
  const tile = continuousRoundedRect(100, 100, 824, 824, 185);

  // `shadow.addFilter(.shadow(color: black 0.28, radius: 18, x: 0, y: 12))` — canvas shadows ignore the transform,
  // so blur and offset are scaled by hand; shadowBlur = 2 × sigma and SwiftUI's radius is the sigma.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = 2 * 18 * k;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 12 * k;
  ctx.fillStyle = WHITE.css;
  ctx.fill(tile);
  ctx.restore();

  const bg = ctx.createLinearGradient(512, 100, 512, 924);
  bg.addColorStop(0, rgb(1.0, 0.9, 0.78).css);
  bg.addColorStop(1, rgb(1.0, 0.72, 0.66).css);
  ctx.fillStyle = bg;
  ctx.fill(tile);

  ctx.save(); // var inside = ctx; inside.clip(to: tile)
  ctx.clip(tile);
  // soft sparkles
  for (const [x, y, r] of [
    [230.0, 250.0, 26.0],
    [800.0, 300.0, 18.0],
    [790.0, 640.0, 14.0],
    [210.0, 610.0, 12.0],
  ] as const) {
    fill(ctx, Paint.sparkle(pt(x, y), r, r * 0.35), WHITE.opacity(0.75));
  }

  const pose = new Pose();
  pose.mouth = "smile";
  pose.look = { x: 0, y: -0.15 };
  const kitty = new KittySkin();
  ctx.save(); // var head = inside
  ctx.translate(512, 600);
  ctx.scale(3.7, 3.7);
  ctx.translate(-100, -146);
  kitty.drawHead(ctx, pose, 0);
  ctx.restore();

  // a window ledge to peek over, with paws hooked on it
  const ledge = ctx.createLinearGradient(512, 790, 512, 924);
  ledge.addColorStop(0, rgb(1.0, 0.98, 0.95).css);
  ledge.addColorStop(1, rgb(0.98, 0.9, 0.86).css);
  ctx.fillStyle = ledge;
  ctx.fillRect(100, 790, 824, 140);
  const edge = new Path2D();
  edge.moveTo(100, 790);
  edge.lineTo(924, 790);
  // `inside.stroke(edge, .color(...), lineWidth: 6)`: SwiftUI's default stroke style (butt caps, miter joins)
  ctx.strokeStyle = rgb(0.93, 0.72, 0.62).css;
  ctx.lineWidth = 6;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  ctx.stroke(edge);
  for (const x of [370, 654]) {
    ctx.save(); // var p = inside
    ctx.translate(x, 792);
    ctx.scale(3.7, 3.7);
    fill(ctx, ellipse(pt(0, 0), 34, 26), kitty.paw, kitty.furEdge, 1.6);
    for (const dx of [-6, 6]) {
      const toe = new Path2D();
      toe.moveTo(dx, -12);
      toe.lineTo(dx, -5);
      line(ctx, toe, kitty.furEdge, 1.6);
    }
    ctx.restore();
  }
  ctx.restore(); // end of `inside`

  ctx.strokeStyle = WHITE.opacity(0.35).css;
  ctx.lineWidth = 4;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  ctx.stroke(tile);
  ctx.restore();
}

/// Swift `AppIcon.menuBarImage(_:badge:)`: the selected character's face (crop 150 around (100, 146), front posture),
/// optionally with the red "someone's waiting" dot, drawn into a sizePx×sizePx area at the context's origin.
// port of AppIcon.menuBarImage
export function drawMenuBarFace(ctx: CanvasRenderingContext2D, skinID: SkinID, badge: boolean, sizePx: number): void {
  const pose = new Pose();
  pose.posture = "front"; // four-legged skins: front view, head centered
  pose.mood = "normal";
  const skin = skinFor(skinID);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, sizePx, sizePx); // the image is exactly the Canvas frame
  ctx.clip();
  const crop = 150;
  ctx.scale(sizePx / crop, sizePx / crop);
  ctx.translate(-(100 - crop / 2), -(146 - crop / 2));
  ctx.save(); // the renderer wraps `skin.draw` the same way
  skin.draw(ctx, pose);
  ctx.restore();
  if (badge) {
    // red "someone's waiting" dot, top-right (undo the crop transform)
    ctx.save();
    ctx.translate(100 - crop / 2, 146 - crop / 2);
    const r = crop * 0.17;
    const c = pt(crop - r * 1.05, r * 1.05);
    fill(ctx, circle(c, r * 2 + crop * 0.05), WHITE);
    fill(ctx, circle(c, r * 2), rgb(1.0, 0.27, 0.27));
    ctx.restore();
  }
  ctx.restore();
}
