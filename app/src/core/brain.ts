// port of Sources/BuddyCore/Brain.swift (Mac reference v0.0.9)

import type { Point } from "./pose";

/// Whether the buddy is living on the desktop or busy getting your attention.
export type PetMode = "idle" | "approaching" | "alert" | "leaving";

/// What the buddy is doing while living on the desktop.
/// `dangle` / `fall`: being carried by the cursor / falling after being dropped (driven by the window, not the brain).
export type Activity =
  | "sit"
  | "lookAround"
  | "walk"
  | "jump"
  | "dance"
  | "yawn"
  | "wave"
  | "sleep"
  | "dangle"
  | "fall"
  // Windows additions (Pooria, 2026-10-15) - picked only when the skin offers them (BrainContext.extras):
  | "meditate"
  | "kata"
  | "kick"
  | "shuriken"
  | "sword"
  | "laptop";

/// Swift `Activity.allCases` (same order).
export const ACTIVITIES: readonly Activity[] = [
  "sit",
  "lookAround",
  "walk",
  "jump",
  "dance",
  "yawn",
  "wave",
  "sleep",
  "dangle",
  "fall",
  "meditate",
  "kata",
  "kick",
  "shuriken",
  "sword",
  "laptop",
];

/// Windows additions: how often each extra activity is picked per mischief (calm, playful, naughty). 0 = never.
const EXTRA_WEIGHTS: Partial<Record<Activity, [number, number, number]>> = {
  meditate: [0.35, 0.35, 0.35], // the rarest of all, same for every mischief level (Pooria)
  kata: [0, 1, 1.4],
  kick: [0, 1, 1.4],
  shuriken: [0, 1, 1.4],
  sword: [0, 0.8, 1.2],
  laptop: [0.8, 0.9, 0.9], // Pooria, 2026-10-16: the Pixel character sometimes works on a laptop
};

export type Mischief = "calm" | "playful" | "naughty";

/// Swift `Mischief.allCases` (same order).
export const MISCHIEFS: readonly Mischief[] = ["calm", "playful", "naughty"];

export interface BrainContextInit {
  now: number;
  x: number;
  minX: number;
  maxX: number;
  mouse?: Point | null;
  mouseMovedAgo?: number;
  userIdle?: number;
  mischief?: Mischief;
  /// Windows addition: extra activities the current skin can play (meditate, ninja moves). Default none.
  extras?: readonly Activity[];
  /// Windows addition: regular activities the current skin never picks (the ninjas do not dance). Default none.
  skips?: readonly Activity[];
}

// port of Brain.swift BrainContext
export class BrainContext {
  now: number;
  /// Buddy's horizontal center on screen and the range it may walk in.
  x: number;
  minX: number;
  maxX: number;
  /// Cursor relative to the buddy's head (screen points, y up), if known.
  mouse: Point | null;
  mouseMovedAgo: number;
  /// Seconds since the human last touched mouse or keyboard.
  userIdle: number;
  mischief: Mischief;
  extras: readonly Activity[];
  skips: readonly Activity[];

  constructor(init: BrainContextInit) {
    this.now = init.now;
    this.x = init.x;
    this.minX = init.minX;
    this.maxX = init.maxX;
    this.mouse = init.mouse ?? null;
    this.mouseMovedAgo = init.mouseMovedAgo ?? 99;
    this.userIdle = init.userIdle ?? 0;
    this.mischief = init.mischief ?? "playful";
    this.extras = init.extras ?? [];
    this.skips = init.skips ?? [];
  }
}

const MASK64 = 0xffffffffffffffffn;

/// Small, seedable RNG so behavior can be tested deterministically.
// port of Brain.swift SplitMix64
export class SplitMix64 {
  private state: bigint;

  constructor(seed: bigint | number) {
    this.state = BigInt.asUintN(64, BigInt(seed));
  }

  /// port of SplitMix64.next
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  }

  /// A double in [0, 1) with 53 random bits.
  nextUnit(): number {
    return Number(this.next() >> 11n) / 2 ** 53;
  }
}

function randomSeed(): bigint {
  const hi = BigInt(Math.floor(Math.random() * 2 ** 32));
  const lo = BigInt(Math.floor(Math.random() * 2 ** 32));
  return (hi << 32n) | lo;
}

/// Decides what the buddy does next while idling. New behaviors go here (and get a pose in `Animator`).
// port of Brain.swift Brain
export class Brain {
  private _activity: Activity = "sit";
  private _activityStart = 0;
  /// Walking direction: 1 = right, -1 = left.
  private _direction = 1;
  private until = 4;
  private lastWave = -100.0;
  private lastChase = -100.0;
  private rng: SplitMix64;

  constructor(seed: bigint | number = randomSeed()) {
    this.rng = new SplitMix64(seed);
  }

  get activity(): Activity {
    return this._activity;
  }

  get activityStart(): number {
    return this._activityStart;
  }

  get direction(): number {
    return this._direction;
  }

  elapsed(now: number): number {
    return now - this._activityStart;
  }

  static walkSpeed(m: Mischief): number {
    return m === "naughty" ? 60 : 40;
  }

  /// Advances the brain; returns the horizontal velocity (points/second) to move the buddy by.
  // port of Brain.swift Brain.tick
  tick(c: BrainContext): number {
    if (this._activity === "dangle" || this._activity === "fall") return 0;

    // Nap while the human is away; wake up with a yawn.
    if (this._activity === "sleep") {
      if (c.userIdle < 1) this.start("yawn", c.now, 2.2);
      return 0;
    }
    if (c.userIdle > (c.mischief === "calm" ? 90 : 150)) {
      this.start("sleep", c.now, Infinity);
      return 0;
    }

    this.reactToCursor(c);
    if (c.now >= this.until) this.pickNext(c);

    if (this._activity !== "walk") return 0;
    const blocked =
      (this._direction > 0 && c.x >= c.maxX) || (this._direction < 0 && c.x <= c.minX);
    if (blocked) {
      if (this.chance(0.5)) {
        this._direction = -this._direction;
      } else {
        this.start("sit", c.now, this.duration("sit", c.mischief));
        return 0;
      }
    }
    return this._direction * Brain.walkSpeed(c.mischief);
  }

  /// Clicked: hop happily (or wake up).
  // port of Brain.swift Brain.poke
  poke(now: number): void {
    if (this._activity === "sleep") this.start("yawn", now, 2.2);
    else this.start("jump", now, 0.6);
  }

  pickUp(now: number): void {
    this.start("dangle", now, Infinity);
  }

  drop(now: number): void {
    this.start("fall", now, Infinity);
  }

  land(now: number): void {
    this.start("jump", now, 0.6);
  }

  settle(now: number): void {
    this.start("sit", now, 4);
  }

  // MARK: -

  // port of Brain.swift Brain.reactToCursor
  private reactToCursor(c: BrainContext): void {
    const m = c.mouse;
    if (!m || !(c.mouseMovedAgo < 0.4) || !(this._activity === "sit" || this._activity === "lookAround")) {
      return;
    }
    const dist = Math.hypot(m.x, m.y);
    if (dist < 170 && c.now - this.lastWave > 25) {
      this.lastWave = c.now;
      this.start("wave", c.now, 1.8);
    } else if (
      c.mischief === "naughty" &&
      dist < 500 &&
      Math.abs(m.x) > 90 &&
      c.now - this.lastChase > 8
    ) {
      // Naughty buddies chase the cursor for a bit.
      this.lastChase = c.now;
      this._direction = m.x > 0 ? 1 : -1;
      this.start("walk", c.now, Math.min(3, Math.abs(m.x) / Brain.walkSpeed(c.mischief)));
    }
  }

  // port of Brain.swift Brain.pickNext
  private pickNext(c: BrainContext): void {
    let table: [Activity, number][];
    switch (c.mischief) {
      case "calm":
        table = [["sit", 6], ["lookAround", 3], ["yawn", 1]];
        break;
      case "playful":
        // Windows: walk 4 -> 5.5 (Pooria, 2026-10-15)
        table = [["sit", 5], ["lookAround", 2], ["walk", 5.5], ["jump", 1], ["dance", 1], ["yawn", 0.7]];
        break;
      case "naughty":
        // Windows: walk 5 -> 6.5 (Pooria, 2026-10-15)
        table = [["sit", 2], ["lookAround", 1], ["walk", 6.5], ["jump", 2], ["dance", 2], ["yawn", 0.4]];
        break;
    }
    const level = c.mischief === "calm" ? 0 : c.mischief === "playful" ? 1 : 2;
    for (const a of c.extras) {
      const w = EXTRA_WEIGHTS[a]?.[level] ?? 0;
      if (w > 0) table.push([a, w]);
    }
    table = table.filter(([a]) => !c.skips.includes(a));
    let next = this.weighted(table);
    if (next === this._activity && next !== "sit") next = "sit";
    // Windows (Pooria): never two special moves in a row - a walk (a sit for Calm, which never walks) comes between.
    if (EXTRA_WEIGHTS[this._activity] !== undefined) next = c.mischief === "calm" ? "sit" : "walk";
    if (next === "walk") {
      const room = c.maxX - c.minX;
      if (room < 40) {
        next = "sit";
      } else if (c.x < c.minX + room * 0.2) {
        this._direction = 1;
      } else if (c.x > c.maxX - room * 0.2) {
        this._direction = -1;
      } else {
        this._direction = this.chance(0.5) ? 1 : -1;
      }
    }
    this.start(next, c.now, this.duration(next, c.mischief));
  }

  // port of Brain.swift Brain.duration
  private duration(a: Activity, m: Mischief): number {
    switch (a) {
      case "sit":
        if (m === "calm") return this.random(6, 14);
        if (m === "playful") return this.random(4, 10);
        return this.random(2.5, 6); // naughty
      case "lookAround":
        return this.random(3, 5);
      case "walk":
        return this.random(2.5, 6);
      case "jump":
        return 0.6;
      case "dance":
        return 3;
      case "yawn":
        return 2.2;
      case "wave":
        return 1.8;
      case "meditate":
        return this.random(7, 12);
      case "kata":
        return 6;
      case "kick":
        return 2.8;
      case "shuriken":
        return 2.8;
      case "sword":
        return 5.2;
      case "laptop":
        return this.random(6, 10);
      case "sleep":
      case "dangle":
      case "fall":
        return Infinity;
    }
  }

  // port of Brain.swift Brain.start
  private start(a: Activity, now: number, seconds: number): void {
    this._activity = a;
    this._activityStart = now;
    this.until = now + seconds;
  }

  // port of Brain.swift Brain.weighted
  private weighted(table: [Activity, number][]): Activity {
    let r = this.random(0, table.reduce((acc, e) => acc + e[1], 0));
    for (const [a, w] of table) {
      if (r < w) return a;
      r -= w;
    }
    return table[0][0];
  }

  /// Swift `Double.random(in: lo...hi, using: &rng)`.
  private random(lo: number, hi: number): number {
    return lo + this.rng.nextUnit() * (hi - lo);
  }

  private chance(p: number): boolean {
    return this.random(0, 1) < p;
  }
}
