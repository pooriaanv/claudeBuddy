// port of Sources/ClaudeBuddy/Render/Skins/BunnySkin.swift (Mac reference v0.0.9)

import type { Point, Pose, Posture } from "../../core/pose";
import { Paint, Palette, WHITE, circle, ellipse, fill, line, pt, rgb, roundedRect } from "../paint";
import type { Color } from "../paint";
import { QuadrupedRig, QuadrupedSkin } from "./quadruped";
import type { KnockTone } from "./skin";

interface FluffyOptions {
  tufts: number;
  tuft: number;
  fill: Color;
  edge: Color;
  from?: number;
  to?: number;
}

/// A fluffy white bunny on four legs: tufty fur, puffy cheeks, a forehead tuft, big sparkly eyes, long ears
/// (one tip folded over, both flop when sleepy), a cotton-ball tail, buck teeth — and it hops instead of walking.
export class BunnySkin extends QuadrupedSkin {
  readonly tone: KnockTone = "paw";

  readonly fur: Color = rgb(1.0, 0.98, 0.96);
  readonly furEdge: Color = rgb(0.84, 0.78, 0.74);
  readonly farFur: Color = rgb(0.94, 0.91, 0.88);
  readonly paw: Color = WHITE;
  readonly pad: Color = rgb(1.0, 0.66, 0.74);
  readonly tailWidth = 4;
  readonly tailTip: Color | null = null;
  readonly wagSpeed = 6.0;
  readonly wagAmount = 1.0;
  override get hops(): boolean {
    return true;
  }

  private readonly pink: Color = rgb(1.0, 0.72, 0.79);

  /// Fur outline: an ellipse with little tufts all around it.
  private fluffy(g: CanvasRenderingContext2D, c: Point, w: number, h: number, o: FluffyOptions): void {
    const { tufts, tuft } = o;
    const from = o.from ?? 0;
    const to = o.to ?? 2 * Math.PI;
    const shapes = (grow: number): Path2D => {
      // `Path(ellipseIn:)` + `addEllipse(in:)` ×n: separate closed subpaths filled with the non-zero rule (a union).
      const p = new Path2D();
      p.addPath(ellipse(c, w + grow * 2, h + grow * 2));
      for (let i = 0; i < tufts; i++) {
        const a = from + ((to - from) * i) / Math.max(1, tufts - (to - from < 6.2 ? 1 : 0));
        const q = pt(c.x + Math.cos(a) * (w / 2 - tuft * 0.25), c.y + Math.sin(a) * (h / 2 - tuft * 0.25));
        p.addPath(circle(q, (tuft + grow) * 2));
      }
      return p;
    };
    g.fillStyle = o.edge.css;
    g.fill(shapes(1.4));
    g.fillStyle = o.fill.css;
    g.fill(shapes(0));
  }

  tailShape(_posture: Posture): Point[] {
    return [pt(-2, -1), pt(-3, -2), pt(-4, -2)];
  }

  frontTail(_p: Pose): { path: Path2D; inFront: boolean } {
    const t = new Path2D();
    t.moveTo(132, 268);
    t.lineTo(134, 267);
    return { path: t, inFront: false };
  }

  drawMarkings(b: CanvasRenderingContext2D, rig: QuadrupedRig): void {
    const h = rig.hip;
    const { fur, furEdge } = this;
    // fluffy back and belly edges
    for (let i = 0; i < 7; i++) {
      const x = h.x - 22 + i * 18;
      fill(b, circle(pt(x, h.y - 27), 16), fur);
      fill(b, circle(pt(x + 6, h.y + 26), 14), fur);
    }
    // cotton tail at the rump
    this.fluffy(b, pt(h.x - 30, h.y - 6), 26, 26, { tufts: 8, tuft: 6, fill: WHITE, edge: furEdge });
    // fluffy white bib
    this.fluffy(b, pt(h.x + QuadrupedRig.bodyLength + 2, h.y + 6), 40, 40, {
      tufts: 7,
      tuft: 6,
      fill: WHITE,
      edge: WHITE,
    });
  }

  drawFrontMarkings(g: CanvasRenderingContext2D): void {
    this.fluffy(g, pt(100, 244), 46, 52, { tufts: 9, tuft: 6, fill: WHITE, edge: WHITE });
  }

  drawHead(h: CanvasRenderingContext2D, p: Pose, tx: number): void {
    const { fur, furEdge, pad } = this;
    const sleepy = p.mood === "sleepy" ? 1.0 : 0.0;
    const perk = p.excitement;
    const twitch = this.earTwitch(p.t);
    this.drawEar(h, true, -14 + perk * 6 - sleepy * 55 - twitch * 8, false);
    this.drawEar(h, false, 14 - perk * 6 + sleepy * 55 + twitch * 3, true);

    // fluffy round head + puffy cheeks
    this.fluffy(h, pt(100, 148), 150, 130, { tufts: 22, tuft: 9, fill: fur, edge: furEdge });
    for (const x of [54.0, 146.0]) {
      this.fluffy(h, pt(x + tx * 0.4, 176), 40, 30, {
        tufts: 5,
        tuft: 7,
        fill: fur,
        edge: fur,
        from: 0.3,
        to: Math.PI - 0.3,
      });
    }
    // forehead tuft
    const tuftBlobs = [
      [-8.0, 90.0, 9.0],
      [4.0, 86.0, 10.0],
      [14.0, 92.0, 7.0],
    ] as const;
    for (const [dx, dy, r] of tuftBlobs) {
      fill(h, circle(pt(100 + dx + tx * 0.3, dy), r * 2 + 2.6), furEdge);
    }
    for (const [dx, dy, r] of tuftBlobs) {
      fill(h, circle(pt(100 + dx + tx * 0.3, dy), r * 2), fur);
    }
    fill(h, ellipse(pt(100, 104), 60, 22), fur); // blend the tuft into the head

    // big sparkly eyes
    const eyePose = p.clone();
    if (p.mood === "normal") eyePose.mood = "excited";
    Paint.blush(h, [pt(56 + tx, 170), pt(144 + tx, 170)], { width: 28, height: 14 }, p);
    Paint.eyes(h, [pt(72 + tx, 143), pt(128 + tx, 143)], { width: 22, height: 26 }, eyePose);
    if (p.eyeOpen > 0.5 && (p.mood === "normal" || p.mood === "excited")) {
      for (const x of [72.0, 128.0]) {
        fill(h, Paint.sparkle(pt(x + tx + 6, 133), 3.5, 1.2), WHITE);
      }
    }

    const m = pt(100 + tx, 163);
    const nose = new Path2D();
    nose.moveTo(m.x - 5, m.y - 3);
    nose.lineTo(m.x + 5, m.y - 3);
    nose.lineTo(m.x, m.y + 2);
    nose.closePath();
    fill(h, nose, pad);
    line(h, nose, pad, 2.4);
    if (p.mouth === "smile" || p.mouth === "small") {
      const w = new Path2D();
      w.moveTo(m.x, m.y + 2);
      w.lineTo(m.x, m.y + 6);
      w.moveTo(m.x - 7, m.y + 6);
      w.quadraticCurveTo(m.x - 3.5, m.y + 10, m.x, m.y + 6);
      w.quadraticCurveTo(m.x + 3.5, m.y + 10, m.x + 7, m.y + 6);
      line(h, w, Palette.ink, 2.1);
      const teeth = roundedRect(m.x - 4.5, m.y + 9, 9, 7, 2);
      fill(h, teeth, WHITE, furEdge, 1.1);
      const gap = new Path2D();
      gap.moveTo(m.x, m.y + 9);
      gap.lineTo(m.x, m.y + 16);
      line(h, gap, furEdge, 1);
    } else {
      Paint.mouth(h, pt(m.x, m.y + 10), p, 13);
    }
  }

  private earTwitch(t: number): number {
    const local = t % 3.7;
    return local < 0.2 ? Math.sin((local / 0.2) * Math.PI) : 0;
  }

  /// Long fluffy ear; the right one has its tip folded over.
  private drawEar(h: CanvasRenderingContext2D, left: boolean, angle: number, folded: boolean): void {
    const { fur, furEdge, pink } = this;
    const anchor = pt(left ? 78 : 122, 98);
    h.save(); // let g = h.rotated(angle, around: anchor)
    h.translate(anchor.x, anchor.y);
    h.rotate((angle * Math.PI) / 180);
    h.translate(-anchor.x, -anchor.y);
    const length = folded ? 70 : 92;
    this.fluffy(h, pt(anchor.x, anchor.y - length / 2 + 4), 36, length, { tufts: 10, tuft: 5, fill: fur, edge: furEdge });
    fill(h, ellipse(pt(anchor.x, anchor.y - length / 2 + 6), 16, length - 28), pink);
    if (folded) {
      // the tip flopping forward
      const top = pt(anchor.x, anchor.y - length + 6);
      h.save(); // let f = g.rotated(left ? -60 : 60, around: top)
      h.translate(top.x, top.y);
      h.rotate(((left ? -60 : 60) * Math.PI) / 180);
      h.translate(-top.x, -top.y);
      this.fluffy(h, pt(top.x, top.y - 14), 30, 32, { tufts: 6, tuft: 5, fill: fur, edge: furEdge });
      fill(h, ellipse(pt(top.x, top.y - 13), 13, 18), pink.opacity(0.8));
      h.restore();
    }
    h.restore();
  }
}
