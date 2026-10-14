import type { Activity } from "../../core/brain";
// port of Sources/ClaudeBuddy/Render/Skins/Skin.swift (Mac reference v0.0.9)

import type { Point, Pose } from "../../core/pose";
import { Paint } from "../paint";

/// Swift `KnockTone` (KnockSound.swift). The sound itself is ported in P4; skins only name their tone.
export type KnockTone = "knuckle" | "paw" | "metal";

/// A character's look. Draws one `Pose` in character space (200×300, feet at y ≈ 288).
///
/// To add a character: add a case to `SkinID` (core/pose.ts), a name to the localization table, a skin file here,
/// and register it in `skinFor` (catalog.ts).
export interface Skin {
  /// Where the right arm attaches; with `reachLength` it defines where the hand meets the glass.
  readonly rightShoulder: Point;
  readonly reachLength: number;
  readonly tone: KnockTone;
  /// Whether the renderer should tilt the whole body when walking/dancing.
  readonly usesLean: boolean;
  /// Windows addition: extra activities this character can play (meditation, ninja moves).
  readonly extras: readonly Activity[];
  /// Windows addition: how far the body sits down onto folded legs while meditating (0 = no folded legs).
  readonly lotusDrop: number;
  /// Where the knock lands on the glass, in character space.
  knockPoint(pose: Pose): Point;
  /// Arm length for the current reach.
  armLength(rest: number, pose: Pose): number;
  /// Draws into `ctx` (already scaled/translated into character space). The renderer wraps the call in
  /// `save()`/`restore()`, mirroring Swift's value-type `GraphicsContext` copy.
  draw(ctx: CanvasRenderingContext2D, pose: Pose): void;
}

/// The Swift `extension Skin` defaults: `usesLean`, `knockPoint`, `armLength`. Skins extend this class and override
/// what differs (four-legged skins override `usesLean` and `knockPoint`).
export abstract class SkinBase implements Skin {
  abstract readonly rightShoulder: Point;
  abstract readonly reachLength: number;
  abstract readonly tone: KnockTone;

  get extras(): readonly Activity[] {
    return [];
  }

  get lotusDrop(): number {
    return 0;
  }

  get usesLean(): boolean {
    return true;
  }

  /// Upright skins: the right arm at -115° when fully reached.
  knockPoint(_pose: Pose): Point {
    return Paint.armEnd(this.rightShoulder, -115, this.reachLength);
  }

  armLength(rest: number, pose: Pose): number {
    return rest + (this.reachLength - rest) * pose.reach;
  }

  abstract draw(ctx: CanvasRenderingContext2D, pose: Pose): void;
}
