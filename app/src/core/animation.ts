// port of Sources/BuddyCore/Animation.swift (Mac reference v0.0.9)

import type { Activity, PetMode } from "./brain";
import { PetScene, Pose } from "./pose";
import type { Point, Posture } from "./pose";

// port of Animation.swift smooth
export function smooth(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
}

// port of Animation.swift lerp
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/// Natural-looking blinks from two overlapping rhythms. 1 = open.
// port of Animation.swift eyeOpen
export function eyeOpen(t: number): number {
  const bump = (period: number, offset: number): number => {
    const local = (t + offset) % period; // truncatingRemainder
    return local < 0.15 ? Math.sin((local / 0.15) * Math.PI) : 0;
  };
  return 1 - 0.92 * Math.max(bump(4.1, 0), bump(6.7, 2.3));
}

// MARK: - Knocking

// port of Animation.swift Knocking.State
export interface KnockingState {
  armUp: number;
  depth: number;
  since: number;
  recent: number[];
}

export const Knocking = {
  /// Hit times (seconds since the alert began): three quick knocks per cycle, frequent at first, then calmer.
  // port of Animation.swift Knocking.schedule
  schedule(start: number): number[] {
    const out: number[] = [];
    let c = start;
    for (let i = 0; i < 60; i++) {
      for (let k = 0; k < 3; k++) out.push(c + k * 0.24);
      c += i < 3 ? 3.2 : 12;
    }
    return out;
  },

  // port of Animation.swift Knocking.state
  state(e: number, hits: number[]): KnockingState {
    const st: KnockingState = { armUp: 0, depth: 0, since: 99, recent: [] };
    let i = 0;
    while (i + 2 < hits.length) {
      const a = hits[i];
      const b = hits[i + 2];
      if (e > a - 0.5 && e < b + 0.6) {
        const up = (e - (a - 0.45)) / 0.3;
        const down = (b + 0.55 - e) / 0.35;
        st.armUp = Math.max(st.armUp, smooth(Math.min(up, down)));
      }
      i += 3;
    }
    for (const h of hits) {
      const d = e - h;
      if (d > -0.12 && d < 0.1) {
        st.depth = Math.max(st.depth, d < 0 ? 1 - Math.pow(d / 0.12, 2) : 1 - Math.pow(d / 0.1, 2));
      }
      if (d >= 0) {
        st.since = Math.min(st.since, d);
        if (d < 2.5) st.recent.push(d);
      }
    }
    return st;
  },
};

// MARK: - Animator

/// Live posture transition from a `PostureTracker`.
// port of Animation.swift PostureTracker.State
export interface PostureTrackerState {
  from: Posture;
  to: Posture;
  blend: number;
}

// port of Animation.swift AnimationInput
export class AnimationInput {
  t: number;
  mode: PetMode = "idle";
  activity: Activity = "sit";
  activityElapsed = 0;
  direction = 1;
  alertElapsed = 0;
  knockHits: number[] = [];
  /// Where to look (-1...1), e.g. toward the cursor; null lets the eyes wander.
  lookTarget: Point | null = null;
  heartAges: number[] = [];
  /// Extra swing (degrees) while carried, from drag speed.
  swing = 0;
  /// Live posture transition from a `PostureTracker`. Null = assume the usual previous posture (previews, snapshots).
  posture: PostureTrackerState | null = null;

  constructor(t: number) {
    this.t = t;
  }
}

/// Remembers the real previous posture so transitions start from where the body actually is.
// port of Animation.swift PostureTracker
export class PostureTracker {
  private _from: Posture = "sit";
  private _to: Posture = "sit";
  private start = -100.0;
  private duration = 0.3;

  get from(): Posture {
    return this._from;
  }

  get to(): Posture {
    return this._to;
  }

  /// port of PostureTracker.update
  update(target: Posture, duration: number, now: number): void {
    if (target === this._to) return;
    // Start from whichever posture the body is mostly in right now.
    this._from = this.blend(now) >= 0.5 ? this._to : this._from;
    this._to = target;
    this.start = now;
    this.duration = duration;
  }

  blend(now: number): number {
    return this.duration <= 0 ? 1 : smooth((now - this.start) / this.duration);
  }

  state(now: number): PostureTrackerState {
    return { from: this._from, to: this._to, blend: this.blend(now) };
  }
}

/// Turns state + time into a pose. Pure and deterministic, so it's easy to preview and test.
// port of Animation.swift Animator
export class Animator {
  // port of Animator.scene
  static scene(i: AnimationInput): PetScene {
    const s = new PetScene();
    const p = new Pose();
    const t = i.t;
    const e = i.activityElapsed;
    p.t = t;
    p.breathe = 1 + Math.sin(t * 1.8) * 0.018;
    p.eyeOpen = eyeOpen(t);
    p.headTilt = Math.sin(t * 1.8) * 6 + Math.sin(t * 0.7) * 2;
    p.headOffset = Math.sin(t * 3.6) * 1.5;
    const armSwing = Math.sin(t * 1.8) * 5;
    p.leftArm = 14 - armSwing;
    p.rightArm = -14 + armSwing;
    p.look = i.lookTarget
      ? { x: i.lookTarget.x, y: i.lookTarget.y }
      : { x: Math.sin(t * 0.37) * Math.sin(t * 0.13), y: 0 };

    const excited = i.mode === "approaching" || i.mode === "alert";
    if (excited) {
      p.mood = "excited";
      p.mouth = "grin";
      p.excitement = 1;
      p.wag = 2.5;
      p.look = { x: 0, y: 0 };
      p.headTilt = Math.sin(t * 3.2) * 4;
      const k = Knocking.state(i.alertElapsed, i.knockHits);
      p.eyeOpen = Math.min(Math.max(eyeOpen(t * 0.6), 0.3), 1 - k.depth * 0.4);
      p.lift = -Math.abs(Math.sin(t * 5.5)) * 3 * (1 - k.armUp * 0.7);
      p.rightArm = lerp(p.rightArm, -125 + k.depth * 10, k.armUp);
      p.reach = k.armUp;
      p.rightArmInFront = k.armUp >= 0.5;
      p.press = 1 + k.depth * 1.3;
      s.knockAges = k.recent;
      if (k.since < 0.14) {
        const f = 1 - k.since / 0.14;
        s.shake = {
          width: Math.sin(k.since * 95) * 2.2 * f,
          height: Math.cos(k.since * 80) * 1.2 * f,
        };
      }
    } else {
      Animator.apply(i.activity, e, i, p, s);
    }

    p.facing = Math.max(-1, Math.min(1, i.direction));
    if (i.posture) {
      const live = i.posture;
      p.posture = live.to;
      p.postureFrom = live.from;
      p.postureBlend = live.blend;
    } else if (excited) {
      p.posture = "front";
      p.postureFrom = "sit";
      p.postureBlend = smooth(i.alertElapsed / 0.45);
    } else {
      const [posture, from, blendTime] = Animator.posture(i.activity);
      p.posture = posture;
      p.postureFrom = from;
      p.postureBlend = smooth(e / blendTime);
    }
    p.airborne = p.lift < -3 || i.activity === "dangle" || i.activity === "fall";

    if (!excited && i.activity !== "sleep" && i.heartAges.some((a) => a < 1.2)) {
      p.mood = "happy";
      p.mouth = "grin";
      p.wag = 3;
    }
    s.heartAges = i.heartAges.filter((a) => a < 1.6);
    s.pose = p;
    return s;
  }

  /// The posture the body should be heading to, and how long getting there takes.
  // port of Animator.targetPosture
  static targetPosture(mode: PetMode, activity: Activity): [Posture, number] {
    if (mode === "approaching" || mode === "alert") return ["front", 0.45];
    const [to, , time] = Animator.posture(activity);
    return [to, time];
  }

  /// Target posture per activity, the posture it usually starts from, and how long the change takes.
  // port of Animator.posture(for:)
  static posture(activity: Activity): [Posture, Posture, number] {
    switch (activity) {
      case "sit":
      case "lookAround":
      case "wave":
        return ["sit", "stand", 0.35];
      case "walk":
      case "jump":
        return ["stand", "sit", 0.3];
      case "dance":
        return ["rear", "sit", 0.3];
      case "yawn":
        return ["stretch", "sit", 0.4];
      case "sleep":
        return ["lie", "sit", 0.8];
      case "dangle":
      case "fall":
        return ["hang", "sit", 0.15];
      // Windows additions
      case "meditate":
        return ["front", "sit", 0.5]; // four-legged skins turn to face you; bipeds ignore the posture
      case "kata":
      case "kick":
      case "shuriken":
      case "sword":
        return ["stand", "sit", 0.3];
    }
  }

  // port of Animator.apply
  private static apply(activity: Activity, e: number, i: AnimationInput, p: Pose, s: PetScene): void {
    const t = i.t;
    switch (activity) {
      case "sit":
        break;
      case "lookAround": {
        const sweep = Math.sin(e * 1.4);
        p.look = { x: sweep, y: -0.2 };
        p.turn = sweep * 0.5;
        p.headTilt += sweep * 4;
        break;
      }
      case "walk": {
        const ph = e * 9;
        p.stepPhase = ph;
        p.lift = -Math.abs(Math.sin(ph)) * 3;
        p.lean = i.direction * 5;
        p.turn = i.direction * 0.6;
        p.look = { x: i.direction, y: 0 };
        p.leftArm = 14 + Math.sin(ph) * 20;
        p.rightArm = -14 + Math.sin(ph) * 20;
        p.headTilt = Math.sin(ph) * 2;
        p.wag = 2;
        break;
      }
      case "jump":
        if (e < 0.6) {
          const h = Math.sin((e / 0.6) * Math.PI);
          p.lift = -h * 26;
          p.leftArm = 14 + h * 60;
          p.rightArm = -14 - h * 60;
          p.mood = "happy";
          p.mouth = "grin";
          p.excitement = h;
        }
        break;
      case "dance": {
        const b = e * 6;
        p.lean = Math.sin(b) * 8;
        p.lift = -Math.abs(Math.sin(b)) * 6;
        p.leftArm = 110 + Math.sin(b) * 40;
        p.rightArm = -110 + Math.sin(b) * 40;
        p.headTilt = Math.sin(b) * 8;
        p.mood = "happy";
        p.mouth = "grin";
        p.wag = 3;
        p.excitement = 0.6;
        s.dancing = true;
        break;
      }
      case "yawn": {
        const q = Math.sin(Math.min(1, e / 2.2) * Math.PI);
        p.mouth = "o";
        p.mouthOpen = 0.4 + q;
        p.eyeOpen = 1 - 0.85 * q;
        p.leftArm = lerp(p.leftArm, 160, q);
        p.rightArm = lerp(p.rightArm, -160, q);
        p.headTilt = -6 * q;
        if (q > 0.3) p.mood = "sleepy";
        break;
      }
      case "wave": {
        const r = smooth(e / 0.25) * smooth((1.8 - e) / 0.25);
        p.rightArm = lerp(p.rightArm, -150 + Math.sin(e * 14) * 22, r);
        p.rightArmInFront = r > 0.5;
        p.mood = "happy";
        p.mouth = "grin";
        p.look = { x: 0, y: 0 };
        break;
      }
      case "sleep":
        p.mood = "sleepy";
        p.mouth = "small";
        p.eyeOpen = 0;
        p.headTilt = 9 + Math.sin(t * 0.8) * 2;
        p.headOffset = 6;
        p.breathe = 1 + Math.sin(t * 1.2) * 0.03;
        p.leftArm = 10;
        p.rightArm = -10;
        p.look = { x: 0, y: 0 };
        p.wag = 0.2;
        s.sleeping = true;
        break;
      case "dangle":
        p.swing = i.swing + Math.sin(t * 5) * 4;
        p.mood = "surprised";
        p.mouth = "o";
        p.mouthOpen = 0.6;
        p.stepPhase = t * 14;
        p.leftArm = 45 + Math.sin(t * 7) * 10;
        p.rightArm = -45 - Math.sin(t * 7) * 10;
        p.look = { x: 0, y: 0 };
        p.wag = 3;
        s.shadow = 0.25;
        break;
      // ---- Windows additions (Pooria, 2026-10-15) ----
      case "meditate": {
        // cross-legged, hands on the knees, eyes closed, floating a little
        const q = smooth(e / 0.6);
        p.lotus = q;
        p.lift = q * (-4 + Math.sin(t * 1.3) * 3); // floats a little (cross-legged skins also sit down: lotusDrop)
        s.zen = q > 0.5;
        p.leftArm = lerp(p.leftArm, 40, q);
        p.rightArm = lerp(p.rightArm, -40, q);
        p.mood = "sleepy";
        p.eyeOpen = 0;
        p.mouth = "small";
        p.headTilt = Math.sin(t * 0.6) * 2;
        p.headOffset = 2 * q;
        p.breathe = 1 + Math.sin(t * 1.0) * 0.025;
        p.look = { x: 0, y: 0 };
        s.shadow = 1 - 0.35 * q;
        break;
      }
      // Martial moves are choreographed with keyframes (Pooria, 2026-10-15): strikes snap out fast, hold for a beat,
      // and come back smoothly - like real kata, not a sine wave.
      case "kata": {
        p.fists = true;
        choreo(p, e, KATA);
        p.mouth = e > 4.7 && e < 5.3 ? "o" : "small"; // kiai on the last strike
        break;
      }
      case "kick": {
        p.fists = true;
        choreo(p, e, KICK);
        p.look = { x: 1, y: 0 };
        p.mouth = "small";
        break;
      }
      case "shuriken": {
        p.fists = true;
        choreo(p, e, SHURIKEN);
        // two throws, one star in the air at a time
        p.shuriken = e >= 0.9 && e < 1.7 ? (e - 0.9) / 0.8 : e >= 1.75 && e < 2.55 ? (e - 1.75) / 0.8 : -1;
        p.look = { x: 1, y: 0 };
        p.mouth = "small";
        break;
      }
      case "sword": {
        // the katana is out while the left arm is above 80 degrees
        choreo(p, e, SWORD);
        p.mouth = "small";
        break;
      }     case "fall":
        p.mood = "surprised";
        p.mouth = "o";
        p.leftArm = 150;
        p.rightArm = -150;
        p.look = { x: 0, y: 0 };
        s.shadow = 0.4;
        break;
    }
  }
}

// ---- Windows additions (Pooria, 2026-10-15): keyframed martial-arts moves ----

/// One pose of a move at time `t` (seconds into the activity). `snap`: reach it fast (a strike), else ease in/out.
interface Key {
  t: number;
  l: number;
  r: number;
  lean?: number;
  lift?: number;
  turn?: number;
  kick?: number;
  snap?: boolean;
}

function choreo(p: Pose, e: number, keys: readonly Key[]): void {
  let i = 0;
  while (i < keys.length - 1 && e >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const u = b.t > a.t ? Math.min(1, Math.max(0, (e - a.t) / (b.t - a.t))) : 1;
  const k = b.snap ? 1 - Math.pow(1 - u, 3) : smooth(u);
  const mix = (x: number | undefined, y: number | undefined): number => lerp(x ?? 0, y ?? 0, k);
  p.leftArm = lerp(a.l, b.l, k);
  p.rightArm = lerp(a.r, b.r, k);
  p.lean = mix(a.lean, b.lean);
  p.lift = mix(a.lift, b.lift);
  p.turn = mix(a.turn, b.turn);
  p.kick = mix(a.kick, b.kick);
  p.look = { x: p.turn * 2, y: 0 };
}

const REST = { l: 14, r: -14 };
const GUARD = { l: 130, r: -130 };

/// ~6 s: ready stance, right / left punch, low block, high block, double punch, final strike with a kiai, rest.
const KATA: readonly Key[] = [
  { t: 0, ...REST },
  { t: 0.5, ...GUARD, lift: 4 },
  { t: 1.0, l: 140, r: -95, lean: 5, turn: 0.3, lift: 4, snap: true },
  { t: 1.35, ...GUARD, lift: 4 },
  { t: 1.6, l: 95, r: -140, lean: -5, turn: -0.3, lift: 4, snap: true },
  { t: 1.95, ...GUARD, lift: 4 },
  { t: 2.3, l: 130, r: -40, lean: 3, lift: 6, snap: true },
  { t: 2.8, l: 170, r: -130, lift: 2, snap: true },
  { t: 3.3, l: 95, r: -95, snap: true },
  { t: 3.8, l: 95, r: -95 },
  { t: 4.2, ...GUARD, lift: 3 },
  { t: 4.7, l: 135, r: -92, lean: 7, turn: 0.4, lift: 3, snap: true },
  { t: 5.3, l: 135, r: -92, lean: 7, turn: 0.4, lift: 3 },
  { t: 6.0, ...REST },
];

/// ~2.8 s: guard, knee up, kick out and hold, re-chamber, second kick, foot down.
const KICK: readonly Key[] = [
  { t: 0, ...REST },
  { t: 0.4, ...GUARD, lean: -2 },
  { t: 0.8, ...GUARD, lean: -5, lift: -3, kick: 0.35 },
  { t: 1.0, l: 140, r: -70, lean: -10, lift: -5, turn: 0.4, kick: 1, snap: true },
  { t: 1.35, l: 140, r: -70, lean: -10, lift: -5, turn: 0.4, kick: 1 },
  { t: 1.6, ...GUARD, lean: -5, lift: -3, kick: 0.35 },
  { t: 1.9, l: 140, r: -70, lean: -11, lift: -6, turn: 0.4, kick: 1, snap: true },
  { t: 2.2, l: 140, r: -70, lean: -11, lift: -6, turn: 0.4, kick: 1 },
  { t: 2.5, ...GUARD, lean: -3, kick: 0.3 },
  { t: 2.8, ...REST },
];

/// ~2.8 s: two throws to the right (wind up, snap, follow through).
const SHURIKEN: readonly Key[] = [
  { t: 0, ...REST },
  { t: 0.4, l: 40, r: -60 },
  { t: 0.75, l: 40, r: -170, lean: -3, turn: 0.3 },
  { t: 0.9, l: 40, r: -75, lean: 6, turn: 0.5, snap: true },
  { t: 1.3, l: 40, r: -60, turn: 0.4 },
  { t: 1.6, l: 40, r: -170, lean: -3, turn: 0.3 },
  { t: 1.75, l: 40, r: -75, lean: 6, turn: 0.5, snap: true },
  { t: 2.2, l: 40, r: -75, lean: 6, turn: 0.5 },
  { t: 2.8, ...REST },
];

/// ~5.2 s: draw, raise high, downward cut, diagonal slash, reverse slash, thrust, salute, sheathe.
const SWORD: readonly Key[] = [
  { t: 0, ...REST },
  { t: 0.5, l: 100, r: -35 },
  { t: 0.9, l: 170, r: -35, lift: 2 },
  { t: 1.3, l: 170, r: -35, lift: 2 },
  { t: 1.45, l: 90, r: -35, lean: 4, lift: 4, snap: true },
  { t: 1.9, l: 90, r: -35, lean: 4, lift: 4 },
  { t: 2.3, l: 145, r: -35 },
  { t: 2.5, l: 100, r: -35, lean: 6, turn: 0.3, snap: true },
  { t: 2.9, l: 160, r: -35, lean: -6, turn: -0.3, snap: true },
  { t: 3.4, l: 92, r: -35, lean: 5, turn: 0.2, snap: true },
  { t: 3.9, l: 92, r: -35, lean: 5, turn: 0.2 },
  { t: 4.4, l: 170, r: -14 },
  { t: 4.8, ...REST },
  { t: 5.2, ...REST },
];