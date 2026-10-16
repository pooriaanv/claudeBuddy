import type { Activity } from "../../core/brain";
// Windows addition (Pooria, 2026-10-16): Byte - an original character in Claude's palette (terracotta, cream,
// charcoal), inspired by, not copying, Claude's mark or Claude Code's mascot. A chunky block head with stepped "pixel"
// corners on a short body; now and then it works on a laptop.

import type { Point, Pose } from "../../core/pose";
import { Paint, drawLotusLegs, fill, line, pt, rgb, roundedRect } from "../paint";
import type { Color, Limb } from "../paint";
import { SkinBase } from "./skin";
import type { KnockTone } from "./skin";

/// The short body: the head and the shoulders sit this much lower than Buddy's.
const DROP = 28;
/// Arm length at rest (short, so the hands stay at the body).
const ARM = 25;
/// The typing arm reaches across the body to the keyboard.
const TYPING_ARM = 56;

export class ByteSkin extends SkinBase {
  readonly rightShoulder: Point = pt(136, 218 + DROP);
  readonly reachLength = 50;
  readonly tone: KnockTone = "knuckle";

  override get lotusDrop(): number {
    return 14;
  }

  override get extras(): readonly Activity[] {
    return ["meditate", "laptop"];
  }

  override get faceCenter(): Point {
    return pt(100, 140 + DROP);
  }

  private readonly terracotta: Color = rgb(0.85, 0.47, 0.34);
  private readonly terraDark: Color = rgb(0.62, 0.3, 0.2);
  private readonly charcoal: Color = rgb(0.17, 0.16, 0.16);

  private get arm(): Limb {
    const { terracotta, terraDark } = this;
    return { fill: terracotta, edge: terraDark, width: 15, handSize: 15, handFill: terracotta, handEdge: terraDark, hand: { kind: "fist" } };
  }

  draw(c: CanvasRenderingContext2D, p: Pose): void {
    const { terracotta, terraDark } = this;
    const arm = this.arm;

    if (p.lotus <= 0.5)
      for (const [x, left] of [
        [86.0, true],
        [114.0, false],
      ] as const) {
        const up = p.footLift(left);
        fill(c, roundedRect(x - 9, 258 - up, 18, 28, 2), terracotta, terraDark);
      }

    // body (breathing)
    c.save();
    c.translate(100, 270);
    c.scale(1, p.breathe);
    c.translate(-100, -270);
    fill(c, roundedRect(62, 204 + DROP, 76, 62 - DROP, 4), terracotta, terraDark);
    c.restore();
    if (p.lotus > 0.5) drawLotusLegs(c, terracotta, terraDark);

    // arms and head in the lowered space
    c.save();
    c.translate(0, DROP);
    const reach = this.armLength(ARM, p);
    if (p.laptop > 0.01) {
      // the holding (right) hand is behind the laptop, the typing (left) one reaches across in front of it
      if (!p.rightArmInFront) Paint.limb(c, arm, pt(136, 218), p.rightArm, reach);
      this.drawLaptop(c, p.laptop, p.t);
      Paint.limb(c, arm, pt(64, 218), p.leftArm, ARM + (TYPING_ARM - ARM) * p.laptop);
    } else {
      Paint.limb(c, arm, pt(64, 218), p.leftArm, ARM);
      if (!p.rightArmInFront) Paint.limb(c, arm, pt(136, 218), p.rightArm, reach);
    }

    c.save();
    Paint.head(c, p, pt(100, 205));
    this.drawHead(c, p, p.turn * 7);
    c.restore();

    if (p.rightArmInFront) Paint.limb(c, arm, pt(136, 218), p.rightArm, reach, p.press);
    c.restore();
  }

  /// The block head: stepped corners, two "antenna pixels", square eyes.
  private drawHead(c: CanvasRenderingContext2D, p: Pose, tx: number): void {
    const { terracotta, terraDark, charcoal } = this;
    const s = 12; // one "pixel"
    const x0 = 34;
    const y0 = 74;
    const w = 132;
    const h = 128;
    const block = new Path2D();
    block.moveTo(x0 + s, y0);
    block.lineTo(x0 + w - s, y0);
    block.lineTo(x0 + w - s, y0 + s);
    block.lineTo(x0 + w, y0 + s);
    block.lineTo(x0 + w, y0 + h - s);
    block.lineTo(x0 + w - s, y0 + h - s);
    block.lineTo(x0 + w - s, y0 + h);
    block.lineTo(x0 + s, y0 + h);
    block.lineTo(x0 + s, y0 + h - s);
    block.lineTo(x0, y0 + h - s);
    block.lineTo(x0, y0 + s);
    block.lineTo(x0 + s, y0 + s);
    block.closePath();
    // two little "antenna pixels"
    for (const x of [62, 126]) fill(c, roundedRect(x - tx * 0.3, y0 - s - 2 * p.excitement, s, s + 2, 1), terracotta, terraDark);
    fill(c, block, terracotta, terraDark, 2.4);
    fill(c, roundedRect(x0 + s, y0 + 6, w - 2 * s, 8, 2), rgb(1, 1, 1).opacity(0.12));
    const asleep = p.mood === "sleepy" && p.eyeOpen < 0.35;
    for (const x of [74, 126]) {
      const ex = x + tx + p.look.x * 4;
      const ey = 136 + p.look.y * 3;
      if (p.mood === "happy" || asleep) {
        fill(c, roundedRect(ex - 10, ey + 2, 20, 6, 1), charcoal);
      } else {
        const eh = Math.max(5, 26 * p.eyeOpen * (p.mood === "excited" ? 1.15 : 1));
        fill(c, roundedRect(ex - 9, ey - eh / 2, 18, eh, 2), charcoal);
        if (p.eyeOpen > 0.5) fill(c, roundedRect(ex - 6, ey - eh / 2 + 3, 6, 6, 1), rgb(1, 1, 1).opacity(0.85));
      }
    }
    Paint.mouth(c, pt(100 + tx, 170), p);
  }

  /// A laptop seen from the side, held at the right - the right hand under it, the left one typing. `q` opens the
  /// lid (0 = shut on the base, 1 = open). Drawn in the lowered space.
  private drawLaptop(c: CanvasRenderingContext2D, q: number, t: number): void {
    const hinge = pt(168, 228);
    const lidLen = 50;
    const a = Math.PI + (Math.PI - 1.32) * q; // left (shut) -> up, tilted back a little
    const tip = pt(hinge.x + Math.cos(a) * lidLen, hinge.y + Math.sin(a) * lidLen);
    // the screen lights the face
    if (q > 0.3) {
      const g = c.createRadialGradient(tip.x - 10, (tip.y + hinge.y) / 2, 4, tip.x - 10, (tip.y + hinge.y) / 2, 80);
      g.addColorStop(0, `rgba(190, 225, 255, ${0.3 * (q - 0.3) / 0.7 * (0.85 + 0.15 * Math.sin(t * 9))})`);
      g.addColorStop(1, "rgba(190, 225, 255, 0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(tip.x - 10, (tip.y + hinge.y) / 2, 80, 0, Math.PI * 2);
      c.fill();
    }
    const body = rgb(0.3, 0.3, 0.34);
    const edge = rgb(0.1, 0.1, 0.12);
    // base (keyboard deck)
    fill(c, roundedRect(104, 226, 70, 8, 3), body, edge, 2);
    const keys = new Path2D();
    keys.moveTo(110, 226);
    keys.lineTo(160, 226);
    line(c, keys, rgb(0.55, 0.56, 0.62), 2);
    // lid, its screen side (facing the character) glowing
    const lid = new Path2D();
    lid.moveTo(hinge.x, hinge.y);
    lid.lineTo(tip.x, tip.y);
    line(c, lid, edge, 9);
    line(c, lid, body, 6);
    if (q > 0.3) {
      const nx = Math.sin(a) * 3;
      const ny = -Math.cos(a) * 3;
      const screen = new Path2D();
      screen.moveTo(hinge.x + nx + (tip.x - hinge.x) * 0.12, hinge.y + ny + (tip.y - hinge.y) * 0.12);
      screen.lineTo(tip.x + nx - (tip.x - hinge.x) * 0.08, tip.y + ny - (tip.y - hinge.y) * 0.08);
      line(c, screen, rgb(0.62, 0.86, 1.0).opacity((q - 0.3) / 0.7), 3);
    }
  }
}
