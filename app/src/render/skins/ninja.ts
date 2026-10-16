import type { Activity } from "../../core/brain";
// port of Sources/ClaudeBuddy/Render/Skins/NinjaSkin.swift (Mac reference v0.0.9)

import type { Point, Pose } from "../../core/pose";
import { Paint, WHITE, addBlur, circle, drawLotusLegs, ellipse, fill, line, pt, rectPath, rgb, roundedRect } from "../paint";
import type { Color, Limb } from "../paint";
import { drawBlockAt, measure } from "../text";
import { SkinBase } from "./skin";
import type { KnockTone } from "./skin";

/// "Shadow" — a dark, menacing ninja: all-black mask with glowing slit eyes, crossed arms, tattered crimson scarf,
/// scratched-out headband plate (rogue ninja), shoulder armor, smoke at its feet, glowing katana when it dances.
/// `glow` picks the eye/blade color (red Ninja, cyan Cyber Ninja).
export class NinjaSkin extends SkinBase {
  readonly rightShoulder: Point = pt(136, 218);
  readonly reachLength = 50;
  readonly tone: KnockTone = "knuckle";

  /// Windows addition (Pooria, 2026-10-15).
  override get lotusDrop(): number {
    return 14;
  }

  override get extras(): readonly Activity[] {
    return ["meditate", "kata", "kick", "shuriken", "sword"];
  }

  /// Pooria, 2026-10-16: ninjas do not dance.
  override get skips(): readonly Activity[] {
    return ["dance"];
  }

  private readonly suit: Color = rgb(0.09, 0.1, 0.13);
  private readonly suitEdge: Color = rgb(0.02, 0.02, 0.03);
  private readonly suitLight: Color = rgb(0.2, 0.22, 0.27);
  private readonly armor: Color = rgb(0.16, 0.17, 0.21);
  private readonly crimson: Color = rgb(0.62, 0.06, 0.14);
  private readonly crimsonDark: Color = rgb(0.36, 0.03, 0.08);
  private readonly steel: Color = rgb(0.52, 0.56, 0.62);
  private readonly glove: Color = rgb(0.05, 0.05, 0.07);

  constructor(private readonly glow: Color = rgb(1.0, 0.18, 0.24)) {
    super();
  }

  private get arm(): Limb {
    return {
      fill: this.suit,
      edge: this.suitEdge,
      width: 16,
      handSize: 17,
      handFill: this.glove,
      handEdge: this.suitEdge,
      hand: { kind: "fist" },
    };
  }

  draw(c: CanvasRenderingContext2D, p: Pose): void {
    const { suit, suitEdge, suitLight, steel, glove } = this;
    const arm = this.arm;
    // Windows addition: martial moves (kata / kick / shuriken) use bare fists, not the katana.
    const swordOut = p.leftArm > 80 && p.mood !== "sleepy" && !p.fists;
    const crossed =
      p.mood === "normal" &&
      p.stepPhase === null &&
      p.reach < 0.01 &&
      !p.rightArmInFront &&
      Math.abs(p.leftArm - 14) < 14 &&
      Math.abs(p.rightArm + 14) < 14;

    this.drawSmoke(c, p);
    this.drawScarf(c, p);

    // scabbard across the back
    const sheath = new Path2D();
    sheath.moveTo(58, 276);
    sheath.lineTo(152, 194);
    line(c, sheath, suitEdge, 13);
    line(c, sheath, rgb(0.14, 0.12, 0.13), 10);

    // legs, wrapped shins (Windows additions: folded for meditation; the right leg swings out for a kick)
    if (p.lotus <= 0.5) for (const [x, left] of [
      [88.0, true],
      [112.0, false],
    ] as const) {
      const up = p.footLift(left);
      if (!left && p.kick > 0.05) continue; // the kicking leg is drawn in front of the body
      c.save();
      fill(c, roundedRect(x - 9, 258 - up, 18, 26, 7), suit, suitEdge, 1.4);
      for (let k = 0; k < 2; k++) {
        const wrap = new Path2D();
        wrap.moveTo(x - 8, 266 - up + k * 6);
        wrap.lineTo(x + 8, 263 - up + k * 6);
        line(c, wrap, suitLight, 1.6);
      }
      fill(c, ellipse(pt(x + (left ? -2 : 2), 285 - up), 24, 10), glove);
      c.restore();
    }

    // body
    c.save(); // var b = c
    c.translate(100, 270);
    c.scale(1, p.breathe);
    c.translate(-100, -270);
    fill(c, roundedRect(58, 206, 84, 64, 26), suit, suitEdge);
    const collar = new Path2D();
    collar.moveTo(80, 208);
    collar.lineTo(108, 244);
    collar.moveTo(120, 208);
    collar.lineTo(100, 234);
    line(c, collar, suitLight, 3);
    fill(c, roundedRect(60, 245, 80, 9, 3), rgb(0.18, 0.18, 0.21));
    for (const x of [74.0, 82.0]) {
      // kunai in the belt
      const k = new Path2D();
      k.moveTo(x, 242);
      k.lineTo(x - 2, 258);
      line(c, k, steel, 2.4);
    }
    c.restore();

    if (p.lotus > 0.5) drawLotusLegs(c, suit, glove, suitEdge);
    if (p.kick > 0.05) this.drawKickLeg(c, p.kick);

    if (!swordOut) this.drawHandle(c);

    if (crossed) {
      this.drawCrossedArms(c);
    } else {
      Paint.limb(c, arm, pt(64, 218), p.leftArm, 42);
      if (swordOut) this.drawKatana(c, pt(64, 218), p.leftArm, 42, p.t);
      if (!p.rightArmInFront) {
        Paint.limb(c, arm, this.rightShoulder, p.rightArm, this.armLength(42, p));
      }
    }
    this.drawShoulderArmor(c);

    c.save(); // drawHead(Paint.head(c, p, pivot: pt(100, 205)), p)
    Paint.head(c, p, pt(100, 205));
    this.drawHead(c, p);
    c.restore();

    if (p.rightArmInFront) {
      Paint.limb(c, arm, this.rightShoulder, p.rightArm, this.armLength(42, p), p.press);
    }
    if (p.shuriken >= 0) this.drawShuriken(c, p);
  }

  /// Windows addition: the right leg swung out sideways, longer as it extends.
  private drawKickLeg(c: CanvasRenderingContext2D, kick: number): void {
    const { suit, suitEdge, suitLight, glove } = this;
    const len = 26 + 30 * kick;
    c.save();
    c.translate(114, 252);
    c.rotate((-kick * 95 * Math.PI) / 180);
    fill(c, roundedRect(-9, 0, 18, len, 8), suit, suitEdge, 1.4);
    const wrap = new Path2D();
    wrap.moveTo(-8, len - 14);
    wrap.lineTo(8, len - 17);
    line(c, wrap, suitLight, 1.6);
    fill(c, ellipse(pt(4, len), 22, 11), glove);
    c.restore();
  }

  /// Windows addition: a spinning throwing star flying off to the right (out of the frame), fading at the end.
  private drawShuriken(c: CanvasRenderingContext2D, p: Pose): void {
    const k = p.shuriken;
    c.save();
    c.globalAlpha *= Math.min(1, (1 - k) / 0.25);
    c.translate(150 + k * 170, 196 - k * 30 - Math.sin(k * Math.PI) * 12);
    c.rotate(p.t * 22);
    const star = new Path2D();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? 13 : 4.5;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.closePath();
    fill(c, star, rgb(0.75, 0.78, 0.84), rgb(0.3, 0.32, 0.36), 1.2);
    fill(c, circle(pt(0, 0), 4), rgb(0.12, 0.12, 0.14));
    c.restore();
  }

  // MARK: head

  private drawHead(h: CanvasRenderingContext2D, p: Pose): void {
    const { suit, suitEdge, steel } = this;
    const tx = p.turn * 6;
    // hood with a swept-back point
    const hood = new Path2D();
    hood.ellipse(24 + 152 / 2, 70 + 142 / 2, 152 / 2, 142 / 2, 0, 0, Math.PI * 2); // addEllipse(in: (24, 70, 152, 142))
    hood.closePath();
    const tip = new Path2D();
    tip.moveTo(150, 84);
    tip.quadraticCurveTo(176, 70, 188, 74);
    tip.lineTo(168, 104);
    tip.closePath();
    fill(h, tip, suit, suitEdge, 2);
    fill(h, hood, suit, suitEdge, 2.4);

    // headband: steel plate, 影 scratched through (rogue ninja)
    h.save(); // var clipped = h; clipped.clip(to: hood)
    h.clip(hood);
    fill(h, rectPath(18, 94, 164, 14), rgb(0.13, 0.13, 0.16));
    h.restore();
    const px = 80 + tx * 0.5;
    const py = 90;
    const pw = 40;
    const ph = 22;
    fill(h, roundedRect(px, py, pw, ph, 3), steel, rgb(0.3, 0.32, 0.37), 1.4);
    drawBlockAt(
      h,
      measure("影", { size: 15, weight: "black", design: "system" }, Infinity),
      px + pw / 2,
      py + ph / 2,
      rgb(0.22, 0.24, 0.29),
      0.7, // Windows CJK fonts have no black weight (Mac: Hiragino W9)
    );
    const scratch = new Path2D();
    scratch.moveTo(px + 3, py + ph - 4);
    scratch.lineTo(px + pw - 3, py + 4);
    line(h, scratch, rgb(0.18, 0.19, 0.23), 2.2);

    // mask: a slightly lighter band where the eyes are
    fill(h, roundedRect(40 + tx, 124, 120, 38, 19), rgb(0.03, 0.03, 0.05));
    this.drawEyes(h, p, tx);
  }

  // MARK: eyes

  /// Narrow glowing slits, inner corner low and outer corner high — a glare. Brighter and pulsing on alert,
  /// narrower when smug (happy), dim when sleepy.
  private drawEyes(h: CanvasRenderingContext2D, p: Pose, tx: number): void {
    const glow = this.glow;
    let open: number;
    switch (p.mood) {
      case "sleepy":
        open = Math.max(0.15, p.eyeOpen);
        break;
      case "surprised":
        open = 1.5;
        break;
      case "happy":
        open = 0.55; // smug narrowing
        break;
      default:
        open = Math.max(0.12, p.eyeOpen);
        break;
    }
    const alert = p.mood === "excited";
    const pulse = alert ? 0.75 + 0.25 * Math.sin(p.t * 10) : 1;
    const strength = (p.mood === "sleepy" ? 0.45 : 1) * pulse;
    const look = p.look.x * 2.5;

    for (const s of [-1.0, 1.0]) {
      const cx = 100 + s * 28 + tx + look;
      const cy = 143;
      const half = 15;
      const height = 9 * open;
      const inner = cx - s * half;
      const outer = cx + s * half;
      const slit = new Path2D();
      slit.moveTo(inner, cy - height / 2 + 5); // inner corner sits lower…
      slit.lineTo(outer, cy - height / 2); // …than the outer one: a glare, not a frown
      slit.lineTo(outer - s * 2, cy + height / 2);
      slit.lineTo(inner + s * 3, cy + height / 2 + 4);
      slit.closePath();
      h.save(); // var halo = h; halo.addFilter(.blur(...))
      addBlur(h, alert ? 7 : 5);
      fill(h, slit, glow.opacity(0.85 * strength));
      h.restore();
      fill(h, slit, glow.opacity(strength));
      h.save(); // var core = h; core.clip(to: slit)
      h.clip(slit);
      fill(h, rectPath(cx - half, cy - 1.5 + 2.5, half * 2, 3), WHITE.opacity(0.65 * strength));
      h.restore();
    }
  }

  // MARK: body parts

  private drawCrossedArms(c: CanvasRenderingContext2D): void {
    const { suit, suitEdge, suitLight, glove } = this;
    // forearms folded across the chest, gloved hands tucked at the elbows
    for (const [from, to] of [
      [pt(64, 222), pt(126, 236)],
      [pt(136, 222), pt(74, 238)],
    ] as const) {
      const a = new Path2D();
      a.moveTo(from.x, from.y);
      a.lineTo(to.x, to.y);
      line(c, a, suitEdge, 19);
      line(c, a, suit, 16);
      fill(c, circle(to, 15), glove, suitEdge, 1.4);
    }
    const wrap = new Path2D();
    wrap.moveTo(92, 226);
    wrap.lineTo(98, 238);
    wrap.moveTo(104, 226);
    wrap.lineTo(110, 236);
    line(c, wrap, suitLight, 1.6);
  }

  private drawShoulderArmor(c: CanvasRenderingContext2D): void {
    for (let i = 0; i < 3; i++) {
      const plate = roundedRect(52 + i * 2, 206 + i * 8, 28 - i * 3, 10, 3);
      fill(c, plate, this.armor, this.suitEdge, 1.2);
    }
  }

  private drawScarf(c: CanvasRenderingContext2D, p: Pose): void {
    const { crimson, crimsonDark } = this;
    const speed = p.stepPhase !== null || p.excitement > 0.5 ? 9.0 : 2.6;
    const knot = pt(128, 202);
    for (const [k, end, w] of [
      [0.0, pt(206, 176), 12.0],
      [1.7, pt(200, 214), 9.0],
    ] as const) {
      const wave = Math.sin(p.t * speed + k) * 8;
      const tail = new Path2D();
      tail.moveTo(knot.x, knot.y);
      tail.bezierCurveTo(152, knot.y - 10 + wave, 180, end.y - wave, end.x, end.y + wave);
      line(c, tail, crimsonDark, w + 2.5);
      line(c, tail, crimson, w);
      // tattered end
      const e = pt(end.x, end.y + wave);
      for (const dy of [-4.0, 3.0]) {
        const rag = new Path2D();
        rag.moveTo(e.x, e.y);
        rag.lineTo(e.x + 9, e.y + dy + wave * 0.3);
        line(c, rag, crimson, 3);
      }
    }
    fill(c, roundedRect(66, 196, 68, 14, 7), crimson, crimsonDark, 1.4);
  }

  /// Dark wisps drifting up around the feet.
  private drawSmoke(c: CanvasRenderingContext2D, p: Pose): void {
    for (let k = 0; k < 5; k++) {
      const ph = (p.t * 0.35 + k / 5) % 1;
      const x = 100 + Math.sin(k * 2.1 + p.t * 0.5) * 46;
      c.save();
      c.globalAlpha = Math.sin(ph * Math.PI) * 0.35;
      addBlur(c, 4);
      c.fillStyle = "#000";
      c.fill(ellipse(pt(x, 284 - ph * 40), 26 + ph * 14, 14 + ph * 8));
      c.restore();
    }
  }

  private drawHandle(c: CanvasRenderingContext2D): void {
    const { glove, crimson } = this;
    fill(c, roundedRect(145, 189, 14, 14, 2), rgb(0.25, 0.26, 0.3));
    const grip = new Path2D();
    grip.moveTo(154, 191);
    grip.lineTo(174, 170);
    line(c, grip, glove, 8);
    for (let i = 0; i < 3; i++) {
      const q = pt(158 + i * 5.5, 186 - i * 6);
      fill(c, roundedRect(q.x - 1.6, q.y - 1.6, 3.2, 3.2, 0.5), crimson);
    }
  }

  /// Drawn katana with a glowing edge.
  private drawKatana(c: CanvasRenderingContext2D, shoulder: Point, angle: number, armLength: number, t: number): void {
    const { glove, suitEdge } = this;
    const hand = Paint.armEnd(shoulder, angle, armLength);
    const dx = (hand.x - shoulder.x) / armLength;
    const dy = (hand.y - shoulder.y) / armLength;
    const along = (d: number): Point => pt(hand.x + dx * d, hand.y + dy * d);
    const grip = new Path2D();
    grip.moveTo(along(-8).x, along(-8).y);
    grip.lineTo(along(10).x, along(10).y);
    line(c, grip, glove, 7);
    fill(c, roundedRect(along(11).x - 7, along(11).y - 7, 14, 14, 2), rgb(0.25, 0.26, 0.3));
    const blade = new Path2D();
    blade.moveTo(along(13).x, along(13).y);
    blade.quadraticCurveTo(along(48).x - dy * 4, along(48).y + dx * 4, along(82).x, along(82).y);
    c.save(); // var halo = c; halo.addFilter(.blur(radius: 6))
    addBlur(c, 6);
    line(c, blade, this.glow.opacity(0.8 + 0.2 * Math.sin(t * 12)), 9);
    c.restore();
    line(c, blade, rgb(0.75, 0.78, 0.84), 4.5);
    line(c, blade, WHITE, 1.6);
    fill(c, circle(hand, 17), glove, suitEdge, 1.6);
  }
}
