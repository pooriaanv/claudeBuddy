// port of Sources/BuddyCore/Pose.swift (Mac reference v0.0.9)

export type Mood = "normal" | "excited" | "happy" | "sleepy" | "surprised";

export type MouthShape = "smile" | "grin" | "o" | "small";

/// Whole-body posture. Bipeds mostly ignore it; four-legged skins use it to sit, stand, rear up, stretch, lie down or hang.
/// `front` = turned fully toward the viewer, sitting (used when knocking on the glass).
export type Posture = "stand" | "sit" | "rear" | "stretch" | "lie" | "hang" | "front";

/// Swift `Posture.allCases` (same order).
export const POSTURES: readonly Posture[] = ["stand", "sit", "rear", "stretch", "lie", "hang", "front"];

/// The available characters. Each has a matching skin in `render/skins`.
/// (Swift's `SkinID.nameKey` needs `L10nKey`; it arrives with core/localization.ts in P1.)
export type SkinID = "buddy" | "kitty" | "puppy" | "bunny" | "robo" | "ninja" | "cyberNinja";

/// Swift `SkinID.allCases` (same order).
export const SKIN_IDS: readonly SkinID[] = ["buddy", "kitty", "puppy", "bunny", "robo", "ninja", "cyberNinja"];

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/// Everything a skin needs to draw one frame.
/// Character space is 200×300 points, y grows downward, feet rest at y ≈ 288.
export class Pose {
  t = 0;
  mood: Mood = "normal";
  eyeOpen = 1;
  /// Where the eyes point, -1...1 on each axis.
  look: Point = { x: 0, y: 0 };
  /// -1...1: face features slide sideways to fake a head turn.
  turn = 0;
  /// Head rotation in degrees around the neck.
  headTilt = 0;
  /// Head vertical offset (+ = down).
  headOffset = 0;
  breathe = 1;
  /// Whole-body vertical offset (- = up), e.g. jumping or bouncing.
  lift = 0;
  /// Degrees, rotating around the feet (walking/dancing).
  lean = 0;
  /// Degrees, rotating around the top of the head (being carried).
  swing = 0;
  /// Radians while walking or kicking; null when standing (Swift `Double?`).
  stepPhase: number | null = null;
  /// Arm angles in degrees; 0 hangs straight down. Left + swings outward-left, right - swings outward-right.
  leftArm = 14;
  rightArm = -14;
  /// 0...1: right arm stretched out toward the glass.
  reach = 0;
  rightArmInFront = false;
  /// Right hand scale while pressed on the glass (1 = normal).
  press = 1;
  mouth: MouthShape = "smile";
  mouthOpen = 1;
  /// Tail wag speed multiplier.
  wag = 1;
  /// 0...1, for ears / antenna perking up.
  excitement = 0;
  /// Posture, blending from `postureFrom` (0) to `posture` (1).
  posture: Posture = "sit";
  postureFrom: Posture = "sit";
  postureBlend = 1;
  /// 1 = facing right, -1 = facing left (side-view skins flip).
  facing = 1;
  /// Feet off the ground (jumping, carried, falling).
  airborne = false;
  /// Windows addition (Pooria, 2026-10-15): 0...1 cross-legged meditation (bipeds draw folded legs).
  lotus = 0;
  /// Windows addition: 0...1 ninja side kick (right leg swung out).
  kick = 0;
  /// Windows addition: 0...1 flight of a thrown shuriken; -1 = none.
  shuriken = -1;
  /// Windows addition: martial-arts moves - bare fists (the ninja doesn't draw its katana).
  fists = false;

  /// Swift structs are value types; TS needs an explicit copy where Swift writes `var p = target`.
  clone(): Pose {
    const p = new Pose();
    Object.assign(p, this);
    p.look = { x: this.look.x, y: this.look.y };
    return p;
  }

  /// Eases the continuous parts of the pose toward `target`, so switching activities never snaps.
  /// `k` is the fraction to move this frame (0...1).
  eased(target: Pose, k: number): Pose {
    const mix = (a: number, b: number): number => a + (b - a) * k;
    const p = target.clone();
    p.lift = mix(this.lift, target.lift);
    p.lean = mix(this.lean, target.lean);
    p.swing = mix(this.swing, target.swing);
    p.headTilt = mix(this.headTilt, target.headTilt);
    p.headOffset = mix(this.headOffset, target.headOffset);
    p.turn = mix(this.turn, target.turn);
    p.leftArm = mix(this.leftArm, target.leftArm);
    p.rightArm = mix(this.rightArm, target.rightArm);
    p.look = { x: mix(this.look.x, target.look.x), y: mix(this.look.y, target.look.y) };
    return p;
  }

  footLift(left: boolean): number {
    const phase = this.stepPhase;
    if (phase === null) return 0;
    const s = Math.sin(phase);
    return Math.max(0, left ? s : -s) * 7;
  }
}

export class Bubble {
  title: string;
  subtitle: string;
  rtl: boolean;
  /// 0...1 pop-in progress.
  appear: number;
  /// Windows addition: extra scale for the in-place knock (1 = Mac).
  scale = 1;

  constructor(title: string, subtitle: string, rtl: boolean, appear: number) {
    this.title = title;
    this.subtitle = subtitle;
    this.rtl = rtl;
    this.appear = appear;
  }
}

/// One frame: a pose plus effects around it.
export class PetScene {
  pose = new Pose();
  shake: Size = { width: 0, height: 0 };
  /// Ages (seconds) of recent knocks on the glass.
  knockAges: number[] = [];
  /// Ages of hearts floating up after a pat.
  heartAges: number[] = [];
  sleeping = false;
  dancing = false;
  /// Windows addition: meditation sparkles.
  zen = false;
  bubble: Bubble | null = null;
  /// Small, calm tag above the head: a session finished while you were looking elsewhere in its app.
  hint: string | null = null;
  knockText = "Knock!";
  /// 0...1 ground shadow strength (fades when lifted off the ground).
  shadow = 1;
}
