import type { Activity } from "../../core/brain";
// port of Sources/ClaudeBuddy/Render/Skins/RoboSkin.swift (Mac reference v0.0.9)

import type { Point, Pose } from "../../core/pose";
import { Paint, circle, ellipse, fill, line, pt, rgb, roundedRect, stroke, WHITE } from "../paint";
import type { Color, Limb } from "../paint";
import { SkinBase } from "./skin";
import type { KnockTone } from "./skin";

/// A tiny hovering robot with a face screen, glowing eyes and a blinking antenna.
export class RoboSkin extends SkinBase {
  readonly rightShoulder: Point = pt(136, 224);
  readonly reachLength = 44;
  readonly tone: KnockTone = "metal";

  /// Windows addition (Pooria, 2026-10-15).
  override get extras(): readonly Activity[] {
    return ["meditate"];
  }

  private readonly shell: Color = rgb(0.94, 0.96, 0.99);
  private readonly shellEdge: Color = rgb(0.7, 0.76, 0.85);
  private readonly metal: Color = rgb(0.79, 0.83, 0.89);
  private readonly screen: Color = rgb(0.12, 0.15, 0.22);
  private readonly glow: Color = rgb(0.4, 0.95, 0.89);
  private readonly coral: Color = rgb(1.0, 0.54, 0.4);
  private readonly pinkGlow: Color = rgb(1.0, 0.49, 0.71);

  private get arm(): Limb {
    return {
      fill: this.metal,
      edge: this.shellEdge,
      width: 12,
      handSize: 16,
      handFill: this.shell,
      handEdge: this.shellEdge,
      hand: { kind: "robot" },
    };
  }

  draw(c: CanvasRenderingContext2D, p: Pose): void {
    const { shell, shellEdge, metal, screen, glow, coral, pinkGlow } = this;
    const arm = this.arm;
    const asleep = p.mood === "sleepy" && p.eyeOpen < 0.35;
    // hovering: bob gently above the floor
    c.save(); // var c = c0
    c.translate(0, -6 + Math.sin(p.t * 2.4) * 3);

    // thruster glow
    const thrust = 0.6 + 0.4 * Math.sin(p.t * 30) * Math.sin(p.t * 17) + (p.stepPhase !== null ? 0.4 : 0);
    fill(c, ellipse(pt(100, 280), 30 * thrust + 10, 12), glow.opacity(asleep ? 0.15 : 0.35));
    fill(c, ellipse(pt(100, 278), 16, 7), glow.opacity(asleep ? 0.3 : 0.9));
    fill(c, roundedRect(86, 262, 28, 14, 6), metal, shellEdge);

    // body
    fill(c, roundedRect(62, 210, 76, 58, 24), shell, shellEdge);
    fill(c, roundedRect(83, 225, 34, 26, 8), screen);
    const beat = asleep ? 0.3 : 0.75 + 0.25 * Math.sin(p.t * 6);
    fill(c, Paint.heart(pt(100, 239), 16 * (0.9 + 0.1 * beat)), pinkGlow.opacity(beat));
    for (const x of [70.0, 130.0]) fill(c, circle(pt(x, 258), 4), shellEdge);

    Paint.limb(c, arm, pt(64, 224), p.leftArm, 38);
    const reach = this.armLength(38, p);
    if (!p.rightArmInFront) {
      Paint.limb(c, arm, this.rightShoulder, p.rightArm, reach);
    }

    // head
    c.save(); // let h = Paint.head(c, p, pivot: pt(100, 208))
    Paint.head(c, p, pt(100, 208));
    const tx = p.turn * 8;
    // antenna
    const antenna = new Path2D();
    antenna.moveTo(100, 86);
    antenna.lineTo(100 + tx * 0.3, 62 - 4 * p.excitement);
    line(c, antenna, metal, 4);
    const blink = p.excitement > 0.5 ? (Math.sin(p.t * 14) > 0 ? 1.0 : 0.35) : asleep ? 0.25 : 0.7 + 0.3 * Math.sin(p.t * 2);
    const tip = pt(100 + tx * 0.3, 56 - 4 * p.excitement);
    fill(c, circle(tip, 22), coral.opacity(0.25 * blink));
    fill(c, circle(tip, 14), coral.opacity(0.5 + 0.5 * blink), rgb(0.85, 0.38, 0.27), 1.5);
    // ear modules
    for (const x of [22.0, 178.0]) {
      fill(c, roundedRect(x - 9, 124, 18, 42, 8), metal, shellEdge);
      fill(c, circle(pt(x, 145), 8), coral);
    }
    fill(c, roundedRect(28, 84, 144, 118, 40), shell, shellEdge, 2.2);
    const face = roundedRect(44, 101, 112, 80, 28);
    fill(c, face, screen);
    fill(c, roundedRect(54, 107, 40, 10, 5), WHITE.opacity(0.07));

    c.save(); // var f = h; f.clip(to: face)
    c.clip(face);
    this.drawFace(c, p, tx, asleep);
    c.restore();
    c.restore(); // end of `h`

    if (p.rightArmInFront) {
      Paint.limb(c, arm, this.rightShoulder, p.rightArm, reach, p.press);
    }
    c.restore(); // end of `c`
  }

  private drawFace(f: CanvasRenderingContext2D, p: Pose, tx: number, asleep: boolean): void {
    const { glow, pinkGlow } = this;
    const eyeColor = asleep ? glow.opacity(0.4) : glow;
    for (const x of [72, 128]) {
      const c = pt(x + tx + p.look.x * 4, 136 + p.look.y * 3);
      if (p.mood === "happy") {
        const a = new Path2D();
        a.moveTo(c.x - 10, c.y + 4);
        a.lineTo(c.x, c.y - 6);
        a.lineTo(c.x + 10, c.y + 4);
        line(f, a, eyeColor, 4.5);
      } else if (p.mood === "surprised") {
        stroke(f, circle(c, 18), eyeColor, 4);
      } else if (asleep) {
        const a = new Path2D();
        a.moveTo(c.x - 9, c.y + 2);
        a.lineTo(c.x + 9, c.y + 2);
        line(f, a, eyeColor, 4);
      } else {
        const big = p.mood === "excited" ? 1.2 : 1;
        const w = 17 * big;
        const h = Math.max(3, 25 * big * p.eyeOpen);
        const eye = roundedRect(c.x - w / 2, c.y - h / 2, w, h, Math.min(w, h) / 2);
        fill(
          f,
          roundedRect(c.x - w / 2 - 4, c.y - h / 2 - 4, w + 8, h + 8, (Math.min(w, h) + 8) / 2),
          eyeColor.opacity(0.25),
        );
        fill(f, eye, eyeColor);
        if (p.eyeOpen > 0.5) fill(f, circle(pt(c.x - w * 0.18, c.y - h * 0.22), w * 0.32), WHITE.opacity(0.85));
      }
    }
    for (const x of [58.0, 142.0]) {
      fill(f, ellipse(pt(x + tx, 160), 16, 7), pinkGlow.opacity(p.mood === "happy" || p.mood === "excited" ? 0.8 : 0.5));
    }
    const m = pt(100 + tx, 163);
    switch (p.mouth) {
      case "grin": {
        const d = new Path2D();
        d.moveTo(m.x - 10, m.y - 3);
        d.lineTo(m.x + 10, m.y - 3);
        d.quadraticCurveTo(m.x, m.y + 14, m.x - 10, m.y - 3);
        d.closePath();
        fill(f, d, glow);
        break;
      }
      case "o":
        stroke(f, ellipse(pt(m.x, m.y + 2), 10, 8 + 6 * p.mouthOpen), glow, 3);
        break;
      case "smile":
      case "small": {
        const s = new Path2D();
        const w = p.mouth === "small" ? 6 : 10;
        s.moveTo(m.x - w, m.y - 1);
        s.quadraticCurveTo(m.x, m.y + 8, m.x + w, m.y - 1);
        line(f, s, asleep ? glow.opacity(0.4) : glow, 3);
        break;
      }
    }
  }
}
