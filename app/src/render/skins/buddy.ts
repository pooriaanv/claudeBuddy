import type { Activity } from "../../core/brain";
// port of Sources/ClaudeBuddy/Render/Skins/BuddySkin.swift (Mac reference v0.0.9)

import type { Point, Pose } from "../../core/pose";
import { Paint, Palette, drawLotusLegs, ellipse, fill, line, pt, rgb, roundedRect } from "../paint";
import type { Color, Limb } from "../paint";
import { SkinBase } from "./skin";
import type { KnockTone } from "./skin";

/// The original little guy: big round head, sprout curl, orange shirt.
export class BuddySkin extends SkinBase {
  readonly rightShoulder: Point = pt(136, 218);
  readonly reachLength = 50;
  readonly tone: KnockTone = "knuckle";

  /// Windows addition (Pooria, 2026-10-15).
  override get lotusDrop(): number {
    return 14;
  }

  override get extras(): readonly Activity[] {
    return ["meditate"];
  }

  private readonly cream: Color = rgb(1.0, 0.9, 0.8);
  private readonly creamEdge: Color = rgb(0.88, 0.7, 0.56);
  private readonly orange: Color = rgb(0.85, 0.47, 0.34);
  private readonly orangeDark: Color = rgb(0.66, 0.33, 0.23);
  private readonly pants: Color = rgb(0.26, 0.25, 0.33);

  private get arm(): Limb {
    return {
      fill: this.orange,
      edge: this.orangeDark,
      width: 16,
      handSize: 17,
      handFill: this.cream,
      handEdge: this.creamEdge,
      hand: { kind: "fist" },
    };
  }

  draw(c: CanvasRenderingContext2D, p: Pose): void {
    const { cream, creamEdge, orange, orangeDark, pants } = this;
    const arm = this.arm;

    // Windows addition: cross-legged for meditation
    // legs + shoes (Windows addition: folded in front of the body for meditation, drawn below)
    if (p.lotus <= 0.5)
    for (const [x, left] of [
      [88.0, true],
      [112.0, false],
    ] as const) {
      const up = p.footLift(left);
      fill(c, roundedRect(x - 8, 262 - up, 16, 22, 7), pants);
      fill(c, ellipse(pt(x + (left ? -2 : 2), 285 - up), 24, 11), Palette.ink);
    }

    // body (breathing)
    c.save(); // var b = c
    c.translate(100, 270);
    c.scale(1, p.breathe);
    c.translate(-100, -270);
    fill(c, roundedRect(58, 206, 84, 64, 30), orange, orangeDark);
    fill(c, Paint.sparkle(pt(100, 240), 9, 3), cream);
    c.restore();
    if (p.lotus > 0.5) drawLotusLegs(c, pants, Palette.ink);

    Paint.limb(c, arm, pt(64, 218), p.leftArm, 42);
    const reach = this.armLength(42, p);
    if (!p.rightArmInFront) {
      Paint.limb(c, arm, this.rightShoulder, p.rightArm, reach);
    }

    // head
    c.save(); // let h = Paint.head(c, p, pivot: pt(100, 205))
    Paint.head(c, p, pt(100, 205));
    const tx = p.turn * 7;
    for (const x of [28.0, 172.0]) {
      fill(c, ellipse(pt(x - tx * 0.4, 150), 24, 26), cream, creamEdge);
    }
    const curl = new Path2D();
    curl.moveTo(100 + tx * 0.5, 74);
    curl.bezierCurveTo(98, 62, 112, 52 - 4 * p.excitement, 96, 50);
    curl.bezierCurveTo(88, 48, 94, 62, 103, 58);
    line(c, curl, orange, 5);
    fill(c, ellipse(pt(100, 140), 148, 140), cream, creamEdge, 2.2);

    Paint.blush(c, [pt(52 + tx, 166), pt(148 + tx, 166)], { width: 24, height: 12 }, p);
    Paint.eyes(c, [pt(72 + tx, 142), pt(128 + tx, 142)], { width: 19, height: 25 }, p);
    const browY = p.mood === "excited" || p.mood === "surprised" ? 110 : 120;
    for (const x of [72.0, 128.0]) {
      const brow = new Path2D();
      brow.moveTo(x + tx - 8, browY + 2);
      brow.quadraticCurveTo(x + tx, browY - 4, x + tx + 8, browY + 2);
      line(c, brow, Palette.ink.opacity(0.8), 3);
    }
    Paint.mouth(c, pt(100 + tx, 168), p);
    c.restore();

    if (p.rightArmInFront) {
      Paint.limb(c, arm, this.rightShoulder, p.rightArm, reach, p.press);
    }
  }
}
