// port of Sources/ClaudeBuddy/Render/Skins/KittySkin.swift (Mac reference v0.0.9)

import type { Point, Pose, Posture } from "../../core/pose";
import { Paint, Palette, ellipse, fill, line, pt, rgb } from "../paint";
import type { Color } from "../paint";
import { QuadrupedRig, QuadrupedSkin } from "./quadruped";
import type { KnockTone } from "./skin";

/// A ginger tabby kitten on four legs: white socks and chest, a long swishy tail,
/// and toe beans that squish on the glass when it rears up to knock.
export class KittySkin extends QuadrupedSkin {
  readonly tone: KnockTone = "paw";

  readonly fur: Color = rgb(0.96, 0.67, 0.38);
  readonly furEdge: Color = rgb(0.8, 0.48, 0.22);
  readonly farFur: Color = rgb(0.88, 0.58, 0.3);
  readonly paw: Color = rgb(1.0, 0.97, 0.93);
  readonly pad: Color = rgb(1.0, 0.62, 0.69);
  readonly tailWidth = 13;
  readonly tailTip: Color | null = null;
  readonly wagSpeed = 2.2;
  readonly wagAmount = 12.0;
  override get wrapsTail(): boolean {
    return true;
  }

  private readonly stripe: Color = rgb(0.88, 0.53, 0.25);
  private get white(): Color {
    return this.paw;
  }

  tailShape(posture: Posture): Point[] {
    switch (posture) {
      case "stand":
        return [pt(-26, 0), pt(-38, -48), pt(-18, -80)];
      case "sit":
      case "front":
        return [pt(-18, 34), pt(30, 44), pt(68, 34)]; // wrapped around the front paws
      case "rear":
        return [pt(-24, 20), pt(-34, 32), pt(-40, 30)]; // on the floor for balance
      case "stretch":
        return [pt(-20, -10), pt(-30, -60), pt(-10, -92)];
      case "lie":
        return [pt(-12, 30), pt(56, 42), pt(104, 30)];
      case "hang":
        return [pt(-6, 30), pt(10, 52), pt(0, 72)];
    }
  }

  /// Front view: tail curls around the front paws.
  frontTail(p: Pose): { path: Path2D; inFront: boolean } {
    const flick = Math.sin(p.t * 2.6) * 5;
    const t = new Path2D();
    t.moveTo(132, 272);
    t.bezierCurveTo(170, 294, 112, 298, 70 + flick, 284);
    return { path: t, inFront: true };
  }

  drawFrontMarkings(g: CanvasRenderingContext2D): void {
    fill(g, ellipse(pt(100, 240), 46, 58), this.paw); // white chest
    for (const [x, s] of [
      [64.0, 1.0],
      [136.0, -1.0],
    ] as const) {
      for (let k = 0; k < 2; k++) {
        const st = new Path2D();
        st.moveTo(x - s * 12, 250 + k * 10);
        st.lineTo(x - s * 2, 254 + k * 10);
        line(g, st, this.stripe, 4);
      }
    }
  }

  drawMarkings(b: CanvasRenderingContext2D, rig: QuadrupedRig): void {
    const h = rig.hip;
    for (let i = 0; i < 4; i++) {
      const x = h.x - 6 + i * 17;
      const s = new Path2D();
      s.moveTo(x, h.y - 29);
      s.lineTo(x + 3, h.y - 16);
      line(b, s, this.stripe, 5);
    }
    fill(b, ellipse(pt(h.x + QuadrupedRig.bodyLength + 6, h.y + 6), 40, 42), this.white); // chest
  }

  drawHead(h: CanvasRenderingContext2D, p: Pose, tx: number): void {
    const { fur, furEdge, pad, white, stripe } = this;
    const twitch = this.earTwitch(p.t) + p.excitement * -6;
    this.drawEar(h, true, twitch);
    this.drawEar(h, false, -twitch * 0.6);
    fill(h, ellipse(pt(100, 146), 158, 128), fur, furEdge, 2.6);
    for (const [x0, x1] of [
      [86.0, 89.0],
      [100.0, 100.0],
      [114.0, 111.0],
    ] as const) {
      const s = new Path2D();
      s.moveTo(x0 + tx * 0.5, 87);
      s.lineTo(x1 + tx * 0.5, 101);
      line(h, s, stripe, 5);
    }
    for (const x of [26.0, 174.0]) {
      const f = new Path2D();
      f.moveTo(x, 150);
      f.lineTo(x + (x < 100 ? -9 : 9), 158);
      f.lineTo(x, 166);
      line(h, f, furEdge, 2);
    }

    Paint.blush(h, [pt(54 + tx, 168), pt(146 + tx, 168)], { width: 22, height: 11 }, p);
    Paint.eyes(h, [pt(70 + tx, 140), pt(130 + tx, 140)], { width: 23, height: 27 }, p);

    const m = pt(100 + tx, 168);
    fill(h, ellipse(pt(m.x - 10, m.y + 4), 30, 22), white);
    fill(h, ellipse(pt(m.x + 10, m.y + 4), 30, 22), white);
    const nose = new Path2D();
    nose.moveTo(m.x - 6, m.y - 6);
    nose.lineTo(m.x + 6, m.y - 6);
    nose.lineTo(m.x, m.y);
    nose.closePath();
    fill(h, nose, pad);
    line(h, nose, pad, 2);
    for (const side of [-1.0, 1.0]) {
      for (const [dy, slope] of [
        [-2.0, -6.0],
        [4.0, 0.0],
        [10.0, 6.0],
      ] as const) {
        const w = new Path2D();
        w.moveTo(m.x + side * 26, m.y + dy);
        w.lineTo(m.x + side * 52, m.y + dy + slope);
        line(h, w, Palette.ink.opacity(0.45), 1.6);
      }
    }
    if (p.mouth === "smile" || p.mouth === "small") {
      const w = new Path2D(); // the "ω" cat mouth
      w.moveTo(m.x - 9, m.y + 3);
      w.quadraticCurveTo(m.x - 4.5, m.y + 9, m.x, m.y + 3);
      w.quadraticCurveTo(m.x + 4.5, m.y + 9, m.x + 9, m.y + 3);
      line(h, w, Palette.ink, 2.4);
    } else {
      Paint.mouth(h, pt(m.x, m.y + 8), p, 14);
    }
  }

  private earTwitch(t: number): number {
    const local = t % 5.3;
    return local < 0.25 ? Math.sin((local / 0.25) * Math.PI) * 10 : 0;
  }

  private drawEar(h: CanvasRenderingContext2D, left: boolean, twitch: number): void {
    const s = left ? 1 : -1;
    const base = pt(100 - s * 48, 96);
    h.save(); // let g = h.rotated(twitch * s, around: base)
    h.translate(base.x, base.y);
    h.rotate(((twitch * s) * Math.PI) / 180);
    h.translate(-base.x, -base.y);
    const x = (v: number): number => 100 - s * (100 - v);
    const outer = new Path2D();
    outer.moveTo(x(30), 122);
    outer.lineTo(x(42), 58);
    outer.lineTo(x(88), 90);
    outer.closePath();
    fill(h, outer, this.fur);
    // g.stroke(outer, .color(furEdge), StrokeStyle(lineWidth: 2.6, lineJoin: .round)) — butt caps, round joins
    h.strokeStyle = this.furEdge.css;
    h.lineWidth = 2.6;
    h.lineCap = "butt";
    h.lineJoin = "round";
    h.stroke(outer);
    const inner = new Path2D();
    inner.moveTo(x(44), 108);
    inner.lineTo(x(48), 74);
    inner.lineTo(x(74), 94);
    inner.closePath();
    fill(h, inner, this.pad);
    h.restore();
  }
}
