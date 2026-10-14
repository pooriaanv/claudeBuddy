// port of Sources/ClaudeBuddy/Render/Skins/PuppySkin.swift (Mac reference v0.0.9)

import type { Point, Pose, Posture } from "../../core/pose";
import { Paint, Palette, WHITE, circle, ellipse, fill, line, pt, rgb, roundedRect } from "../paint";
import type { Color } from "../paint";
import type { QuadrupedRig } from "./quadruped";
import { QuadrupedSkin } from "./quadruped";
import type { KnockTone } from "./skin";

/// A cream puppy on four legs: floppy brown ears, a brown back patch, red collar and a curly, waggy tail.
export class PuppySkin extends QuadrupedSkin {
  readonly tone: KnockTone = "paw";

  readonly fur: Color = rgb(1.0, 0.95, 0.87);
  readonly furEdge: Color = rgb(0.85, 0.72, 0.56);
  readonly farFur: Color = rgb(0.94, 0.87, 0.77);
  readonly paw: Color = rgb(1.0, 0.95, 0.87);
  readonly pad: Color = rgb(0.86, 0.5, 0.56);
  readonly tailWidth = 12;
  get tailTip(): Color | null {
    return this.ear;
  }
  readonly wagSpeed = 9.0;
  readonly wagAmount = 14.0;

  private readonly ear: Color = rgb(0.6, 0.39, 0.25);
  private readonly earEdge: Color = rgb(0.47, 0.29, 0.18);
  private readonly patch: Color = rgb(0.92, 0.73, 0.54);
  private readonly collar: Color = rgb(0.9, 0.28, 0.3);
  private readonly gold: Color = rgb(0.96, 0.77, 0.27);

  tailShape(posture: Posture): Point[] {
    switch (posture) {
      case "stand":
        return [pt(-16, -12), pt(-30, -40), pt(-12, -46)]; // curled up
      case "sit":
      case "front":
        return [pt(-16, 20), pt(-30, 30), pt(-42, 28)]; // sweeping the floor
      case "rear":
        return [pt(-16, 18), pt(-28, 28), pt(-38, 26)];
      case "stretch":
        return [pt(-14, -16), pt(-26, -48), pt(-8, -54)];
      case "lie":
        return [pt(-10, 24), pt(30, 36), pt(56, 28)];
      case "hang":
        return [pt(-4, 20), pt(6, 34), pt(0, 44)];
    }
  }

  /// Front view: tail peeks out at the side, wagging.
  frontTail(p: Pose): { path: Path2D; inFront: boolean } {
    const wag = Math.sin(p.t * this.wagSpeed * p.wag) * 14;
    const t = new Path2D();
    t.moveTo(128, 262);
    t.bezierCurveTo(150, 262, 166 + wag * 0.6, 240, 158 + wag, 222);
    return { path: t, inFront: false };
  }

  drawFrontMarkings(g: CanvasRenderingContext2D): void {
    fill(g, ellipse(pt(100, 244), 44, 54), WHITE.opacity(0.7));
    fill(g, ellipse(pt(128, 228), 22, 20), this.patch);
  }

  override drawFrontNeck(g: CanvasRenderingContext2D): void {
    fill(g, roundedRect(70, 200, 60, 11, 5.5), this.collar);
    fill(g, circle(pt(100, 216), 12), this.gold, rgb(0.8, 0.6, 0.15), 1.5);
  }

  drawMarkings(b: CanvasRenderingContext2D, rig: QuadrupedRig): void {
    const h = rig.hip;
    fill(b, ellipse(pt(h.x + 22, h.y - 14), 50, 30), this.patch);
    fill(b, ellipse(pt(h.x - 14, h.y - 10), 22, 20), this.patch);
  }

  override drawNeck(g: CanvasRenderingContext2D, rig: QuadrupedRig): void {
    const c = rig.headCenter;
    const band = roundedRect(c.x - 34, c.y + 36, 52, 11, 5.5);
    fill(g, band, this.collar);
    fill(g, circle(pt(c.x - 8, c.y + 52), 11), this.gold, rgb(0.8, 0.6, 0.15), 1.5);
  }

  drawHead(h: CanvasRenderingContext2D, p: Pose, tx: number): void {
    const { fur, furEdge, patch } = this;
    fill(h, ellipse(pt(100, 145), 152, 132), fur, furEdge, 2.6);
    fill(h, ellipse(pt(131 + tx, 137), 42, 38), patch);
    for (const x of [74.0, 126.0]) {
      fill(h, ellipse(pt(x + tx, 116), 11, 7), patch); // eyebrow dots
    }

    const flop = -p.headTilt * 0.6 - p.excitement * 14 + Math.sin(p.stepPhase ?? 0) * 8;
    this.drawEar(h, true, flop);
    this.drawEar(h, false, -flop);

    Paint.blush(h, [pt(54 + tx, 168), pt(146 + tx, 168)], { width: 22, height: 11 }, p);
    Paint.eyes(h, [pt(72 + tx, 140), pt(128 + tx, 140)], { width: 20, height: 24 }, p);

    const m = pt(100 + tx, 170);
    fill(h, ellipse(m, 60, 40), WHITE);
    fill(h, ellipse(pt(m.x, m.y - 9), 21, 14), Palette.ink);
    fill(h, ellipse(pt(m.x - 4, m.y - 12), 6, 3.5), WHITE.opacity(0.8));
    const philtrum = new Path2D();
    philtrum.moveTo(m.x, m.y - 3);
    philtrum.lineTo(m.x, m.y + 3);
    line(h, philtrum, Palette.ink, 2.2);
    if (p.mouth === "o") {
      Paint.mouth(h, pt(m.x, m.y + 6), p, 14);
    } else {
      const smile = new Path2D();
      smile.moveTo(m.x - 11, m.y + 2);
      smile.quadraticCurveTo(m.x - 6, m.y + 9, m.x, m.y + 3);
      smile.quadraticCurveTo(m.x + 6, m.y + 9, m.x + 11, m.y + 2);
      line(h, smile, Palette.ink, 2.4);
    }
    if (p.mouth === "grin" || p.stepPhase !== null) {
      // panting
      const wiggle = Math.sin(p.t * 12) * 1.5;
      const tongueEdge = rgb(0.85, 0.38, 0.45);
      fill(h, roundedRect(m.x - 7, m.y + 5 + wiggle, 14, 15, 7), Palette.blush, tongueEdge, 1.4);
      const mid = new Path2D();
      mid.moveTo(m.x, m.y + 8 + wiggle);
      mid.lineTo(m.x, m.y + 15 + wiggle);
      line(h, mid, tongueEdge, 1.4);
    }
  }

  private drawEar(h: CanvasRenderingContext2D, left: boolean, angle: number): void {
    const s = left ? 1 : -1;
    const x = (v: number): number => 100 - s * (100 - v);
    h.save(); // let g = h.rotated(angle * s, around: pt(x(46), 98))
    const pivot = pt(x(46), 98);
    h.translate(pivot.x, pivot.y);
    h.rotate(((angle * s) * Math.PI) / 180);
    h.translate(-pivot.x, -pivot.y);
    const e = new Path2D();
    e.moveTo(x(48), 92);
    e.bezierCurveTo(x(24), 98, x(6), 146, x(16), 168);
    e.bezierCurveTo(x(26), 186, x(50), 176, x(52), 152);
    e.bezierCurveTo(x(56), 128, x(58), 104, x(48), 92);
    e.closePath();
    fill(h, e, this.ear, this.earEdge, 2);
    h.restore();
  }
}
