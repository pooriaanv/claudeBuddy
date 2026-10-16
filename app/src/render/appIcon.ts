// port of Sources/ClaudeBuddy/AppIcon.swift (Mac reference v0.0.9)
//
//
// Windows: the app icon is its own design (Pooria, 2026-10-16: "something interesting, not too cute") - a fist knocking
// on a pane of glass. The tray face is still the selected character's face, as on the Mac.
// `writeIconset` / `png` (NSImage + iconutil) have no counterpart here: the snapshot tool exports the PNGs and
// `tauri icon` makes the .ico / .png set from the 1024 one.

import { Pose } from "../core/pose";
import type { SkinID } from "../core/pose";
import { WHITE, circle, fill, pt, rgb } from "./paint";
import { skinFor } from "./skins/catalog";

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

/// The knock rings: three arcs going out from (cx, cy) to the right, each fainter than the last.
function knockRings(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, from: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  [0, 1, 2].forEach((i) => {
    ctx.globalAlpha = 1 - i * 0.28;
    ctx.lineWidth = 30 - i * 5;
    ctx.beginPath();
    ctx.arc(cx, cy, from + i * 58, -0.7, 0.7);
    ctx.stroke();
  });
  ctx.restore();
}

/// Draws the icon in a 1024×1024 space (an 824 rounded square in the middle), scaled into a size×size area at the
/// context's origin.
export function drawIcon(ctx: CanvasRenderingContext2D, size: number): void {
  const k = size / 1024;
  ctx.save();
  ctx.scale(k, k);
  const tile = continuousRoundedRect(100, 100, 824, 824, 185);

  // Canvas shadows ignore the transform, so blur and offset are scaled by hand.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 2 * 18 * k;
  ctx.shadowOffsetY = 12 * k;
  ctx.fillStyle = "#000";
  ctx.fill(tile);
  ctx.restore();
  const bg = ctx.createLinearGradient(512, 100, 512, 924);
  bg.addColorStop(0, "#3b3f58");
  bg.addColorStop(1, "#1c1e2b");
  ctx.fillStyle = bg;
  ctx.fill(tile);

  ctx.save();
  ctx.clip(tile);
  // the pane of glass: tinted, a bright edge, one diagonal reflection
  const glass = ctx.createLinearGradient(300, 150, 700, 900);
  glass.addColorStop(0, "rgba(160, 220, 255, 0.30)");
  glass.addColorStop(1, "rgba(160, 220, 255, 0.08)");
  ctx.fillStyle = glass;
  ctx.fillRect(470, 100, 454, 824);
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(466, 100, 10, 824);
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.moveTo(620, 100);
  ctx.lineTo(700, 100);
  ctx.lineTo(540, 924);
  ctx.lineTo(460, 924);
  ctx.fill();
  knockRings(ctx, 470, 512, "#ffb38a", 110);
  // a fist from the left: forearm, knuckles against the glass, the thumb's crease
  ctx.fillStyle = "#ffcfa8";
  ctx.strokeStyle = "#c9876a";
  ctx.lineWidth = 10;
  ctx.fillRect(100, 445, 200, 150);
  const fist = continuousRoundedRect(240, 395, 190, 250, 80);
  ctx.fill(fist);
  ctx.stroke(fist);
  for (const y of [440, 500, 560]) {
    ctx.beginPath();
    ctx.arc(425, y + 10, 34, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(300, 600);
  ctx.quadraticCurveTo(360, 560, 400, 610);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = WHITE.opacity(0.12).css;
  ctx.lineWidth = 6;
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
