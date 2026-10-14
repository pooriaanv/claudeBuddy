import type { Activity } from "../../core/brain";
// port of Sources/ClaudeBuddy/Render/Skins/Quadruped.swift (Mac reference v0.0.9)

import { lerp, smooth } from "../../core/animation";
import type { Point, Pose, Posture } from "../../core/pose";
import { Paint, circle, ellipse, fill, line, pt, roundedRect } from "../paint";
import type { Color, Limb } from "../paint";
import { SkinBase } from "./skin";

/// Side-view four-legged body shared by Kitty, Puppy and Bunny: the body is in profile, the (big, cute) head faces you.
/// All coordinates are for facing right; the skin mirrors itself when facing left.
// port of QuadrupedRig
export class QuadrupedRig {
  static readonly bodyLength = 74;
  static readonly floor = 288;
  /// Where the front paw presses the glass while rearing up.
  static readonly knockTarget: Point = pt(166, 176);

  readonly pose: Pose;
  /// Body angle in degrees around the hip; negative lifts the chest.
  readonly theta: number;
  readonly drop: number;
  /// 0...1: hind legs folded into a sitting haunch.
  readonly haunch: number;
  /// 0...1: legs tucked under (lying down).
  readonly tuck: number;
  /// 0...1: front legs stretched forward (yawn stretch).
  readonly stretch: number;
  readonly hip: Point;
  /// Hopping gait (bunnies): front feet together, hind feet together, body bouncing.
  readonly hops: boolean;
  /// Vertical bounce of the whole body while hopping (negative = up).
  readonly hop: number;

  constructor(p: Pose, hops = false) {
    this.pose = p;
    this.hops = hops;
    this.hop = hops && p.stepPhase !== null && !p.airborne ? -Math.abs(Math.sin((p.stepPhase ?? 0) / 2)) * 14 : 0;
    // theta, drop, haunch, tuck, stretch
    const params = (s: Posture): number[] => {
      switch (s) {
        case "stand":
          return [0, 0, 0, 0, 0];
        case "sit":
          return [-38, 4, 1, 0, 0];
        case "rear":
          return [-68, 0, 1, 0, 0];
        case "stretch":
          return [14, 0, 0, 0, 1];
        case "lie":
          return [0, 22, 0, 1, 0];
        case "hang":
          return [-80, -6, 0, 0, 0];
        case "front":
          return [-38, 4, 1, 0, 0]; // side view never shows it; behaves like sitting
      }
    };
    const from = params(p.postureFrom);
    const to = params(p.posture);
    const v = from.map((a, i) => lerp(a, to[i], p.postureBlend));
    this.theta = v[0];
    this.drop = v[1];
    this.haunch = v[2];
    this.tuck = v[3];
    this.stretch = v[4];
    this.hip = pt(52, 236 + this.drop + this.hop);
  }

  /// A point given relative to the hip along the body axis, in character space.
  world(l: Point): Point {
    const a = (this.theta * Math.PI) / 180;
    return pt(this.hip.x + l.x * Math.cos(a) - l.y * Math.sin(a), this.hip.y + l.x * Math.sin(a) + l.y * Math.cos(a));
  }

  get chest(): Point {
    return this.world(pt(QuadrupedRig.bodyLength, 0));
  }

  get rump(): Point {
    return this.world(pt(-24, -8));
  }

  get headCenter(): Point {
    const c = this.chest;
    return pt(c.x + 16, c.y - 50);
  }

  attach(front: boolean, near: boolean): Point {
    return this.world(pt((front ? 66 : 6) - (near ? 0 : 13), 22));
  }

  /// How much a front paw is lifted (waving, batting), read from the upright arm angles.
  pawRaise(near: boolean): number {
    const pose = this.pose;
    if (!(pose.posture === "sit" || pose.posture === "rear" || pose.posture === "front")) return 0;
    return smooth(((near ? -pose.rightArm : pose.leftArm) - 35) / 90);
  }

  foot(front: boolean, near: boolean): Point {
    const a = this.attach(front, near);
    const p = this.pose;
    // diagonal pairs move together, like a real walk
    const pairOffset = this.hops ? (front ? 0 : Math.PI) : front === near ? 0 : Math.PI;
    const phase = (p.stepPhase ?? 0) + pairOffset;
    const raise = front ? this.pawRaise(near) : 0;

    if (p.airborne || QuadrupedRig.floor - a.y > (front ? 82 : 44)) {
      const kick = p.stepPhase !== null ? Math.sin(phase) * 6 : 0;
      return pt(a.x + 8 + raise * 14, a.y + 26 - raise * 30 + kick);
    }
    let dx = 0;
    let lift = 0;
    if (p.stepPhase !== null) {
      dx = Math.sin(phase) * 9;
      lift = Math.max(0, Math.cos(phase)) * 7;
    }
    if (front) dx += this.stretch * 22;
    let f = pt(a.x + dx, QuadrupedRig.floor - 5 - lift + this.hop);
    if (raise > 0) {
      const wave = Math.sin(p.t * 14) * 6 * raise;
      f = pt(f.x + raise * 18, f.y - raise * (f.y - a.y + 14) + wave);
    }
    return f;
  }
}

/// Front view geometry: the right front paw lifts from here to tap the glass.
// port of FrontSit
export const FrontSit = {
  shoulder: pt(114, 228),
  legLength: 56,
  reachLength: 52,
} as const;

interface HeadPlacement {
  center: Point;
  scale: number;
  tx: number;
}

/// Swift `GraphicsContext.drawLayer` with `opacity`: the content is drawn into an off-screen layer first and composited
/// once with `alpha`, so overlapping parts of the layer do not show through each other (a plain `globalAlpha` on the
/// individual shapes would). The layer has the device-pixel size of the target canvas and starts with its current
/// transform, so `fn` draws in exactly the same coordinate system as the caller.
let scratchLayer: OffscreenCanvas | null = null;

function drawLayer(ctx: CanvasRenderingContext2D, alpha: number, fn: (layer: CanvasRenderingContext2D) => void): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (scratchLayer === null || scratchLayer.width !== w || scratchLayer.height !== h) {
    scratchLayer = new OffscreenCanvas(w, h);
  }
  const l = scratchLayer.getContext("2d") as unknown as CanvasRenderingContext2D;
  l.save();
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.clearRect(0, 0, w, h);
  l.setTransform(ctx.getTransform());
  fn(l);
  l.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.drawImage(scratchLayer, 0, 0);
  ctx.restore();
}

/// A four-legged skin supplies colors, tail shapes, body markings and a head; the rig does the rest.
/// (Swift: `protocol QuadrupedSkin: Skin` plus its `extension QuadrupedSkin` defaults.)
// port of QuadrupedSkin
export abstract class QuadrupedSkin extends SkinBase {
  /// Windows addition (Pooria, 2026-10-15): a cute meditation - facing you, eyes closed, floating.
  override get extras(): readonly Activity[] {
    return ["meditate"];
  }

  abstract readonly fur: Color;
  abstract readonly furEdge: Color;
  abstract readonly farFur: Color;
  abstract readonly paw: Color;
  abstract readonly pad: Color;
  abstract readonly tailWidth: number;
  abstract readonly tailTip: Color | null;
  abstract readonly wagSpeed: number;
  abstract readonly wagAmount: number;

  /// Tail curls around the front paws (in front of the body) when sitting or lying.
  get wrapsTail(): boolean {
    return false;
  }

  /// Hops instead of walking.
  get hops(): boolean {
    return false;
  }

  /// Tail control point 1, control point 2 and tip, relative to the rump.
  abstract tailShape(posture: Posture): Point[];
  /// Drawn in body space (rotated with the body), using `rig.hip` as the origin.
  abstract drawMarkings(body: CanvasRenderingContext2D, rig: QuadrupedRig): void;
  /// Drawn between body and head (collars etc).
  drawNeck(_g: CanvasRenderingContext2D, _rig: QuadrupedRig): void {}
  /// Front-facing head drawn around (100, 146), about 150 wide; scaled down by the rig.
  abstract drawHead(h: CanvasRenderingContext2D, pose: Pose, tx: number): void;

  // Front view (sitting, facing the viewer — used while knocking).
  abstract frontTail(pose: Pose): { path: Path2D; inFront: boolean };
  abstract drawFrontMarkings(g: CanvasRenderingContext2D): void;
  drawFrontNeck(_g: CanvasRenderingContext2D): void {}

  // --- extension QuadrupedSkin defaults --------------------------------------------------------------------------

  get rightShoulder(): Point {
    return QuadrupedRig.knockTarget;
  }

  get reachLength(): number {
    return 0;
  }

  override get usesLean(): boolean {
    return false;
  }

  /// Four-legged buddies always knock from the front view.
  override knockPoint(_pose: Pose): Point {
    return Paint.armEnd(FrontSit.shoulder, -115, FrontSit.reachLength);
  }

  /// Turning toward you: the side and front bodies crossfade while one head glides between their positions
  /// (crossfading two faces would show four eyes).
  draw(ctx: CanvasRenderingContext2D, p: Pose): void {
    const f = p.posture === "front" ? p.postureBlend : p.postureFrom === "front" ? 1 - p.postureBlend : 0;
    if (f <= 0.01) {
      this.drawSide(ctx, p);
      this.placeHead(ctx, p, this.sideHead(p));
      return;
    }
    if (f >= 0.99) {
      this.drawFrontBody(ctx, p);
      this.placeHead(ctx, p, this.frontHead());
      this.drawFrontPaw(ctx, p);
      return;
    }
    drawLayer(ctx, 1 - f, (l) => this.drawSide(l, p));
    drawLayer(ctx, f, (l) => this.drawFrontBody(l, p));

    const a = this.sideHead(p);
    const b = this.frontHead();
    const k = f;
    this.placeHead(ctx, p, {
      center: pt(a.center.x + (b.center.x - a.center.x) * k, a.center.y + (b.center.y - a.center.y) * k),
      scale: a.scale + (b.scale - a.scale) * k,
      tx: a.tx * (1 - k),
    });
    drawLayer(ctx, f, (l) => this.drawFrontPaw(l, p));
  }

  private frontHead(): HeadPlacement {
    return { center: pt(100, 150), scale: 0.88, tx: 0 };
  }

  /// Where the side view puts the head. The head itself is never mirrored (it faces you), only its position follows
  /// the body as it turns around.
  private sideHead(p: Pose): HeadPlacement {
    const c = new QuadrupedRig(p, this.hops).headCenter;
    return { center: pt(100 + (c.x - 100) * p.facing, c.y), scale: 0.74, tx: (p.turn + 0.25 * p.facing) * 8 };
  }

  private placeHead(g: CanvasRenderingContext2D, p: Pose, at: HeadPlacement): void {
    g.save(); // var h = g
    g.translate(at.center.x, at.center.y + p.headOffset);
    g.rotate(((p.headTilt * 0.6) * Math.PI) / 180);
    g.scale(at.scale, at.scale);
    g.translate(-100, -146);
    this.drawHead(g, p, at.tx);
    g.restore();
  }

  private get frontLeg(): Limb {
    return {
      fill: this.fur,
      edge: this.furEdge,
      width: 16,
      handSize: 19,
      handFill: this.paw,
      handEdge: this.furEdge,
      hand: { kind: "paw", pad: this.pad },
    };
  }

  /// Sitting, turned fully toward the viewer (everything but the head and the knocking paw).
  drawFrontBody(g: CanvasRenderingContext2D, p: Pose): void {
    const { fur, furEdge, paw } = this;
    const tail = this.frontTail(p);
    const strokeTail = (): void => {
      line(g, tail.path, furEdge, this.tailWidth + 3);
      line(g, tail.path, fur, this.tailWidth);
    };
    if (!tail.inFront) strokeTail();

    // haunches and hind paws
    for (const x of [64, 136]) {
      fill(g, ellipse(pt(x, 262), 50, 50), fur, furEdge);
      fill(g, ellipse(pt(x + (x < 100 ? -6 : 6), 283), 26, 12), paw, furEdge, 1.6);
    }
    g.save(); // var b = g
    g.translate(100, 284);
    g.scale(1, p.breathe);
    g.translate(-100, -284);
    fill(g, ellipse(pt(100, 242), 82, 88), fur, furEdge);
    this.drawFrontMarkings(g);
    g.restore();

    const leg = this.frontLeg;
    Paint.limb(g, leg, pt(86, 228), 0, FrontSit.legLength);
    if (p.reach < 0.01) Paint.limb(g, leg, FrontSit.shoulder, 0, FrontSit.legLength);
    if (tail.inFront) strokeTail();
    this.drawFrontNeck(g);
  }

  /// The right front paw lifting to tap the glass (drawn over the head — it's closest to you).
  drawFrontPaw(g: CanvasRenderingContext2D, p: Pose): void {
    if (!(p.reach >= 0.01)) return;
    const k = p.reach;
    const length = FrontSit.legLength + (FrontSit.reachLength - FrontSit.legLength) * k;
    Paint.limb(g, this.frontLeg, FrontSit.shoulder, k * p.rightArm, length, p.press);
  }

  /// The body in profile (no head). `facing` between -1 and 1 squeezes it through the middle: turning around.
  drawSide(ctx: CanvasRenderingContext2D, p: Pose): void {
    const { fur, furEdge, farFur, paw } = this;
    const g = ctx;
    g.save(); // var g = ctx
    const facing = p.facing;
    const flip = Math.abs(facing) < 0.06 ? (facing < 0 ? -0.06 : 0.06) : facing;
    g.translate(100, 0);
    g.scale(flip, 1);
    g.translate(-100, 0);
    const rig = new QuadrupedRig(p, this.hops);
    const legsVisible = rig.tuck < 0.5;
    const sitting = rig.haunch > 0.5;
    const tailInFront = this.wrapsTail && (p.posture === "sit" || p.posture === "lie") && p.postureBlend > 0.5;

    if (!tailInFront) this.drawTail(g, rig);

    if (legsVisible) {
      this.leg(g, rig.attach(true, false), rig.foot(true, false), farFur);
      if (!sitting) this.leg(g, rig.attach(false, false), rig.foot(false, false), farFur);
    }

    g.save(); // var body = g.rotated(rig.theta, around: rig.hip)
    g.translate(rig.hip.x, rig.hip.y);
    g.rotate((rig.theta * Math.PI) / 180);
    g.translate(-rig.hip.x, -rig.hip.y);
    g.translate(0, rig.hip.y);
    g.scale(1, p.breathe);
    g.translate(0, -rig.hip.y);
    const torso = roundedRect(rig.hip.x - 30, rig.hip.y - 30, QuadrupedRig.bodyLength + 56, 58, 29);
    fill(g, torso, fur, furEdge);
    this.drawMarkings(g, rig);
    g.restore();

    if (legsVisible) {
      if (sitting) {
        const h = pt(rig.hip.x + 14, QuadrupedRig.floor - 23);
        fill(g, ellipse(h, 56, 46), fur, furEdge);
        fill(g, ellipse(pt(h.x + 22, QuadrupedRig.floor - 5), 24, 12), paw, furEdge, 1.6);
      } else {
        this.leg(g, rig.attach(false, true), rig.foot(false, true), fur);
      }
      this.leg(g, rig.attach(true, true), rig.foot(true, true), fur);
    } else {
      // loaf: front paws peeking out
      for (const dx of [2, 18]) {
        fill(g, ellipse(pt(rig.chest.x + dx, QuadrupedRig.floor - 6), 22, 12), paw, furEdge, 1.6);
      }
    }

    if (tailInFront) this.drawTail(g, rig);
    this.drawNeck(g, rig);
    g.restore();
  }

  private leg(g: CanvasRenderingContext2D, a: Point, f: Point, color: Color, press = 1): void {
    const l = new Path2D();
    l.moveTo(a.x, a.y);
    l.lineTo(f.x, f.y);
    line(g, l, this.furEdge, 18);
    line(g, l, color, 15);
    if (press > 1.05) {
      // paw pressed flat on the glass, toe beans showing
      const d = 18 * press;
      fill(g, circle(f, d), this.paw, this.furEdge, 1.6);
      Paint.beans(g, f, d, this.pad);
    } else {
      fill(g, ellipse(pt(f.x + 3, f.y), 21, 12), this.paw, this.furEdge, 1.6);
    }
  }

  private drawTail(g: CanvasRenderingContext2D, rig: QuadrupedRig): void {
    const p = rig.pose;
    const from = this.tailShape(p.postureFrom);
    const to = this.tailShape(p.posture);
    const k = p.postureBlend;
    const mix = (i: number): Point => pt(from[i].x + (to[i].x - from[i].x) * k, from[i].y + (to[i].y - from[i].y) * k);
    const calm = p.posture === "sit" || p.posture === "lie" ? 0.4 : 1;
    const sway = Math.sin(p.t * this.wagSpeed * p.wag) * this.wagAmount * calm;
    const r = rig.rump;
    const c1 = mix(0);
    const c2 = mix(1);
    const tip = mix(2);
    const end = pt(r.x + tip.x + sway, r.y + tip.y);
    const path = new Path2D();
    path.moveTo(r.x, r.y);
    path.bezierCurveTo(r.x + c1.x, r.y + c1.y, r.x + c2.x + sway * 0.6, r.y + c2.y, end.x, end.y);
    line(g, path, this.furEdge, this.tailWidth + 3);
    line(g, path, this.fur, this.tailWidth);
    if (this.tailTip !== null) fill(g, circle(end, this.tailWidth - 1), this.tailTip);
  }
}
