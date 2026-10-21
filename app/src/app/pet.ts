// port of Sources/ClaudeBuddy/PetController.swift (Mac reference v0.0.9) -- 12-windows-plan.md P3, D5-D8.
//
// Owns the buddy's window: living on the desktop floor (walking, being carried, falling) and coming up to the glass
// to knock. Runs one frame clock whose rate follows what's happening.
//
// Units: everything the controller keeps is in GLOBAL PHYSICAL PIXELS with the y axis pointing DOWN (D5). Mac point
// constants are multiplied by the scale of the monitor involved; the Brain still works in points (it is a pure
// port with its own constants), so BrainContext gets points and its velocity is converted back.
// Mac y-up -> Windows y-down is marked "(y axis)" below.

import { IN_PLACE_BUBBLE_SCALE } from "../render/sceneRenderer";
import { AnimationInput, Animator, Knocking, PostureTracker, smooth } from "../core/animation";
import type { HitKind, KnockPlan } from "../core/animation";
import { Brain, BrainContext } from "../core/brain";
import type { Activity, PetMode } from "../core/brain";
import { Bubble, PetScene } from "../core/pose";
import type { Point, Pose, SkinID } from "../core/pose";
import { skinFor } from "../render/skins/catalog";
import type { KnockTone, Skin } from "../render/skins/skin";
import {
  alertFrame,
  alertScreen,
  animationRect,
  clamp,
  defaultCenterX,
  ease,
  floorScreen,
  headCenter,
  idleFrame,
  roundRect,
  workAreaOf,
} from "./geometry";
import type { FrameAnimationShape, MonitorInfo, Rect } from "./geometry";
import type { PressHandler } from "./hitTest";
import type { Preferences } from "./prefs";
import type { PetLevel, PointerState } from "./types";

/// What the controller needs from the outside world (Tauri in the app, a fake in tests).
export interface PetPlatform {
  /// `pointer_state()`.
  pointerState(): Promise<PointerState>;
  /// `set_pet_frame`: physical px, already rounded.
  setFrame(frame: Rect): void;
  /// `set_pet_level`.
  setLevel(level: PetLevel): void;
  /// Windows addition: end of a drag - above the app window under (x, y), or desktop level.
  dropLevel(x: number, y: number): void;
  /// Draws one scene into the canvas for a window of `frame.w` x `frame.h` physical px.
  draw(scene: PetScene, skin: Skin, frame: Rect): void;
  /// DEBUG (P3): summary of the `set_pet_frame` call times since the last call, for the log.
  takeFrameStats?(): string | null;
}

/// Knock sound hook (`KnockSound`, ported in P4). `release` is called when going home.
export interface KnockSoundPlayer {
  /// `kind`: Windows addition - the impatient knock's stomp / clap / slam, and the glass cracking.
  play(tone: KnockTone, kind?: HitKind | "crack"): void;
  release(): void;
}

const NO_SOUND: KnockSoundPlayer = { play() {}, release() {} };

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const timeoutScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface PetOptions {
  prefs: Preferences;
  platform: PetPlatform;
  monitors: readonly MonitorInfo[];
  /// Seconds, monotonic (Swift `CACurrentMediaTime`). Default `performance.now() / 1000` (D7).
  now?: () => number;
  /// Milliseconds on the same clock as `now`, used by the input safety net. Default `performance.now()`.
  nowMs?: () => number;
  scheduler?: Scheduler;
  /// `BUDDY_DEBUG`: frame-rate changes and events.
  log?: (line: string) => void;
  /// Seeds the Brain (tests); default random.
  brain?: Brain;
}

interface FrameAnimation extends FrameAnimationShape {
  start: number;
  duration: number;
  overshoot: boolean;
  done: () => void;
}

/// Mac `PetController.fall`: gravity in pt/s^2.
export const GRAVITY_PT = 2600;
/// Mac `PetController.buildScene`: the eyes follow the cursor within this distance (pt), saturating at 220 pt.
export const LOOK_RANGE_PT = 450;
export const LOOK_SATURATION_PT = 220;

export class PetController implements PressHandler {
  /// Clicked while knocking.
  onDismissRequested: (() => void) | null = null;
  /// Clicked while on the desktop (acknowledges the hint).
  onPetted: (() => void) | null = null;
  /// Quiet tag shown above the head while on the desktop.
  hint: string | null = null;
  /// Plugged in by P4 (Web Audio).
  sound: KnockSoundPlayer = NO_SOUND;
  /// Called at the start of every tick with the fresh pointer sample (the input layer's drag / release logic).
  onPointerState: ((ps: PointerState, sampledAtMs: number) => void) | null = null;

  private readonly prefs: Preferences;
  private readonly platform: PetPlatform;
  private monitors: readonly MonitorInfo[];
  private readonly clockNow: () => number;
  private readonly clockNowMs: () => number;
  private readonly scheduler: Scheduler;
  private readonly log: ((line: string) => void) | undefined;

  private readonly brain: Brain;
  private skinID: SkinID;
  private readonly skins = new Map<SkinID, Skin>();
  private scene = new PetScene();

  private clockTimer: unknown = null;
  private clockFPS = 0;
  private nextDueMs = 0;
  private lastTick: number;
  private ticking = false;
  private tickAgain = false;
  private stopped = false;
  private pointer: PointerState = { x: 0, y: 0, leftDown: false, idleSecs: 0 };

  private _mode: PetMode = "idle";
  private centerX: number;
  private dragging = false;
  private pressing = false;
  private falling = false;
  private fallSpeed = 0;
  private swing = 0;
  private lastDragX = 0;
  private hearts: number[] = [];
  private readonly postures = new PostureTracker();
  /// Smoothed walking direction, so turning around takes a moment instead of snapping.
  private facing = 1;
  private lastPose: Pose | null = null;
  private lastMouse: Point = { x: 0, y: 0 };
  private mouseMovedAt = 0;
  private lastActivity: Activity;

  private alertStart = 0;
  private hits: number[] = [];
  /// Windows addition: the kind of each hit, when the glass cracks (seconds since the alert began), and when it did.
  private kinds: HitKind[] = [];
  private crackAt = Infinity;
  private crackedAt: number | null = null;
  private nextHit = 0;
  private bubbleText: { title: string; subtitle: string } | null = null;
  private animation: FrameAnimation | null = null;

  /// The window frame (Mac `panel.frame`), unrounded; `frame()` is what has been sent to Win32.
  private current: Rect;

  constructor(opts: PetOptions) {
    this.prefs = opts.prefs;
    this.platform = opts.platform;
    this.monitors = opts.monitors;
    this.clockNow = opts.now ?? (() => performance.now() / 1000);
    this.clockNowMs = opts.nowMs ?? (() => performance.now());
    this.scheduler = opts.scheduler ?? timeoutScheduler;
    this.log = opts.log;
    this.brain = opts.brain ?? new Brain();
    this.lastTick = this.now;
    this.skinID = this.prefs.skin;
    // `init`: saved petX (physical px) or the right side of the main screen, 120 pt from the work-area edge.
    this.centerX = this.prefs.petX ?? defaultCenterX(this.monitors);
    this.current = this.idleFrame();
    this.lastActivity = this.brain.activity;
  }

  get mode(): PetMode {
    return this._mode;
  }

  get activity(): Activity {
    return this.brain.activity;
  }

  /// The scene drawn by the last tick.
  get lastScene(): PetScene {
    return this.scene;
  }

  /// Seconds on the controller's clock.
  private get now(): number {
    return this.clockNow();
  }

  // MARK: lifecycle

  /// port of `PetController.start`: window on the floor, brain settles, first frame (drawn before the window is shown).
  async start(): Promise<void> {
    this.skinID = this.prefs.skin;
    this.applyFrame(this.idleFrame());
    this.brain.settle(this.now);
    await this.tick();
  }

  /// Stops the frame clock (tests, quit).
  stop(): void {
    this.stopped = true;
    if (this.clockTimer !== null) this.scheduler.clear(this.clockTimer);
    this.clockTimer = null;
  }

  /// port of `PetController.relayout`: size or screens changed.
  relayout(): void {
    this.skinID = this.prefs.skin;
    if (this._mode !== "idle" || this.dragging) return;
    this.falling = false;
    this.applyFrame(this.idleFrame());
  }

  /// `didChangeScreenParametersNotification`: new monitor list, then relayout.
  screensChanged(monitors: readonly MonitorInfo[]): void {
    this.monitors = monitors;
    this.relayout();
  }

  // MARK: knocking

  knock(title: string, subtitle: string): void {
    this.bubbleText = { title, subtitle };
    if (this._mode === "alert" || this._mode === "approaching") {
      this.setPlan(this.now - this.alertStart + 0.5); // someone new: knock again soon (a cracked glass stays cracked)
      this.nextHit = 0;
      return;
    }
    this.dragging = false;
    this.falling = false;
    this.brain.settle(this.now);
    this._mode = "approaching";
    this.alertStart = this.now;
    this.crackedAt = null;
    this.setPlan(1.0);
    this.nextHit = 0;
    this.platform.setLevel("front"); // panel.level = .statusBar; panel.orderFrontRegardless()
    this.debug(`knock: "${title}" / "${subtitle}"`);
    if (this.prefs.knockStyle === "inPlace") {
      // Windows addition: knock where it stands - same size, a little hop, above every window; the window only grows
      // upward to make room for the bubble (the renderer keeps the character at the bottom).
      const f = this.current;
      const extra = Math.round(f.h * 0.3);
      this.animate({ x: f.x, y: f.y - extra, w: f.w, h: f.h + extra }, 0.5, false, 30, this.scale(), () => {
        this._mode = "alert";
      });
      return;
    }
    const target = this.alertScreenAndFrame();
    this.animate(target.frame, 0.85, true, 80, target.monitor.scale, () => {
      this._mode = "alert";
    });
  }

  updateBubble(title: string, subtitle: string): void {
    this.bubbleText = { title, subtitle };
  }

  goHome(): void {
    if (this._mode !== "alert" && this._mode !== "approaching") return;
    this._mode = "leaving";
    this.sound.release();
    this.debug("goHome");
    const home = this.idleFrame();
    this.animate(home, 0.6, false, 40, floorScreen(this.monitors, this.centerX).scale, () => {
      this.platform.setLevel("desktop"); // panel.level = desktopLevel
      this._mode = "idle";
      this.brain.land(this.now);
    });
  }

  // MARK: input (PetHostView callbacks, wired through PressTracker)

  clicked(): void {
    switch (this._mode) {
      case "alert":
      case "approaching":
        this.onDismissRequested?.();
        break;
      case "idle":
        this.hearts.push(this.now);
        this.brain.poke(this.now);
        this.onPetted?.();
        break;
      case "leaving":
        break;
    }
    this.debug(`click mode=${this._mode} activity=${this.brain.activity}`);
    void this.tick();
  }

  canDrag(): boolean {
    return this._mode === "idle";
  }

  dragBegan(): void {
    this.dragging = true;
    this.falling = false;
    this.swing = 0;
    this.lastDragX = this.pointer.x;
    this.brain.pickUp(this.now);
    this.platform.setLevel("front"); // Windows addition: visible above everything while carried
    this.debug(`drag began at (${this.pointer.x}, ${this.pointer.y}) frame=${fmt(this.current)}`);
  }

  /// `p` = cursor, `grab` = cursor offset inside the window when the press began (global physical px).
  dragMoved(p: Point, grab: Point): void {
    // Mac: panel.setFrameOrigin(p - grab) -- the same arithmetic in a y-down space.
    this.applyFrame({ ...this.current, x: p.x - grab.x, y: p.y - grab.y });
    const dx = (p.x - this.lastDragX) / this.scale();
    this.lastDragX = p.x;
    this.swing = Math.max(-28, Math.min(28, this.swing * 0.8 - dx * 0.9));
  }

  dragEnded(): void {
    this.dragging = false;
    this.platform.dropLevel(this.pointer.x, this.pointer.y); // Windows addition: dropped over an app -> in front of all apps; over the desktop -> behind them
    this.centerX = this.current.x + this.current.w / 2;
    this.prefs.petX = this.centerX;
    void this.prefs.flushPetX();
    // Mac: falls if frame.minY > idle.minY + 2 (y up). Here the window is HIGHER when its y is smaller.
    if (this.current.y < this.idleFrame().y - 2 * this.scale()) {
      this.falling = true;
      this.fallSpeed = 0;
      this.brain.drop(this.now);
    } else {
      this.brain.land(this.now);
    }
    this.debug(`drag ended centerX=${Math.round(this.centerX)} y=${Math.round(this.current.y)} falling=${this.falling}`);
  }

  /// Not in Swift: the frame clock runs at 60 fps while the button is down, so a drag starts without waiting for a
  /// slow idle tick (AppKit delivers mouse events directly; here the press is polled by the tick).
  pressChanged(pressing: boolean): void {
    this.pressing = pressing;
    if (pressing) this.scheduleClock(this.desiredFPS());
  }

  /// PressHandler: the window frame as applied.
  frame(): Rect {
    return roundRect(this.current);
  }

  /// PressHandler: px per pt where the pet is.
  scale(): number {
    return floorScreen(this.monitors, this.current.x + this.current.w / 2).scale;
  }

  // MARK: frame clock

  /// One frame. Reentrant calls (a click asking for an immediate frame during a tick) run right after the current one.
  async tick(): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        await this.tickOnce();
      } while (this.tickAgain && !this.stopped);
    } finally {
      this.ticking = false;
    }
  }

  private async tickOnce(): Promise<void> {
    // D7: one pointer_state() per tick replaces NSEvent.mouseLocation / mouse buttons / Focus.userIdleSeconds().
    const sampledAt = this.clockNowMs();
    try {
      this.pointer = await this.platform.pointerState();
    } catch {
      // keep the last sample
    }
    this.onPointerState?.(this.pointer, sampledAt);

    const t = this.now;
    const dt = Math.min(0.1, t - this.lastTick);
    this.lastTick = t;

    if (this.animation !== null) this.stepAnimation(this.animation, t);

    if (this._mode === "idle" && !this.dragging && this.animation === null) {
      if (this.falling) this.stepFall(dt);
      else this.stepWalk(dt, t);
    }
    if (this._mode === "alert" || this._mode === "approaching") this.playDueKnocks(t);
    if (!this.dragging) this.swing *= 0.9;
    this.hearts = this.hearts.filter((h) => t - h <= 1.6);

    this.scene = this.buildScene(t, dt);
    this.platform.draw(this.scene, this.skin(), this.frame());
    if (this.brain.activity !== this.lastActivity) {
      this.debug(`activity ${this.lastActivity} → ${this.brain.activity}  x=${Math.round(this.centerX)}`);
      this.lastActivity = this.brain.activity;
    }
    this.scheduleClock(this.desiredFPS());
  }

  private stepAnimation(a: FrameAnimation, t: number): void {
    const x = Math.min(1, (t - a.start) / a.duration);
    if (x >= 1) {
      // Mac sets the interpolated frame (k = 1, hop = sin(pi) * hop ~ 0) and then `a.to`: only `a.to` matters.
      this.animation = null;
      this.applyFrame(a.to);
      const stats = this.platform.takeFrameStats?.();
      if (stats) this.debug(`animation done: ${stats}`);
      a.done();
      return;
    }
    this.applyFrame(animationRect(a, x, ease(x, a.overshoot)));
  }

  private stepFall(dt: number): void {
    const s = this.scale();
    this.fallSpeed += GRAVITY_PT * s * dt;
    const floor = this.idleFrame().y;
    let y = this.current.y + this.fallSpeed * dt; // (y axis) Mac: origin.y -= v * dt; lands when <= floor
    if (y >= floor) {
      y = floor;
      this.falling = false;
      this.brain.land(this.now);
      this.debug(`landed y=${Math.round(y)} floor=${floor}`);
    } else {
      this.debug(`fall y=${Math.round(y)} v=${Math.round(this.fallSpeed)}`);
    }
    this.applyFrame({ ...this.current, y });
  }

  private stepWalk(dt: number, t: number): void {
    const frame = this.current;
    const m = floorScreen(this.monitors, this.centerX);
    const s = m.scale;
    const wa = workAreaOf(m);
    const mouse = this.pointer;
    if (mouse.x !== this.lastMouse.x || mouse.y !== this.lastMouse.y) {
      this.lastMouse = { x: mouse.x, y: mouse.y };
      this.mouseMovedAt = t;
    }
    const head = headCenter(frame);
    const minX = wa.x + frame.w / 2;
    const maxX = wa.x + wa.w - frame.w / 2;
    // The Brain works in points with Mac's y-up cursor offset (y axis: flipped).
    const ctx = new BrainContext({
      now: t,
      x: this.centerX / s,
      minX: minX / s,
      maxX: maxX / s,
      mouse: { x: (mouse.x - head.x) / s, y: -(mouse.y - head.y) / s },
      mouseMovedAgo: t - this.mouseMovedAt,
      userIdle: mouse.idleSecs,
      mischief: this.prefs.mischief,
      extras: this.skin().extras,
      skips: this.skin().skips,
    });
    const v = this.brain.tick(ctx);
    if (v !== 0) {
      this.centerX = Math.min(maxX, Math.max(minX, this.centerX + v * s * dt));
      this.applyFrame({ ...frame, x: this.centerX - frame.w / 2 });
      this.prefs.petX = this.centerX;
    }
  }

  /// Ordinary knocks, or (pref on) the impatient plan: rhythm, slams, cracked glass.
  private setPlan(start: number): void {
    const plan: KnockPlan = this.prefs.impatient
      ? Knocking.impatient(start)
      : { hits: Knocking.schedule(start), kinds: [], crackAt: Infinity };
    this.hits = plan.hits;
    this.kinds = plan.kinds;
    this.crackAt = this.crackedAt === null ? plan.crackAt : Infinity;
  }

  private playDueKnocks(t: number): void {
    const e = t - this.alertStart;
    while (this.nextHit < this.hits.length && this.hits[this.nextHit] <= e) {
      if (this.prefs.soundOn && e - this.hits[this.nextHit] < 0.1) {
        this.sound.play(this.skin().tone, this.kinds[this.nextHit] ?? "knock");
      }
      this.nextHit += 1;
    }
    if (this.crackedAt === null && e >= this.crackAt) {
      this.crackedAt = this.crackAt;
      this.hits = this.hits.slice(0, this.nextHit); // no more knocking on a broken glass
      this.debug("impatient: the glass cracked");
      if (this.prefs.soundOn && e - this.crackAt < 0.2) this.sound.play(this.skin().tone, "crack");
    }
  }

  private buildScene(t: number, dt: number): PetScene {
    const turnStep = (dt / 0.3) * 2;
    this.facing += Math.max(-turnStep, Math.min(turnStep, this.brain.direction - this.facing));
    const target = Animator.targetPosture(this._mode, this.brain.activity);
    this.postures.update(target[0], target[1], t);

    const input = new AnimationInput(t);
    input.mode = this._mode;
    input.activity = this.brain.activity;
    input.activityElapsed = this.brain.elapsed(t);
    input.direction = this.facing;
    input.posture = this.postures.state(t);
    input.alertElapsed = t - this.alertStart;
    input.knockHits = this.hits;
    input.knockKinds = this.kinds;
    input.crackAge = this.crackedAt === null ? -1 : t - this.alertStart - this.crackedAt;
    input.heartAges = this.hearts.map((h) => t - h);
    input.swing = this.swing;
    if (this._mode === "idle") {
      const head = headCenter(this.current);
      const s = this.scale();
      const dx = (this.pointer.x - head.x) / s;
      const dy = (this.pointer.y - head.y) / s;
      if (Math.hypot(dx, dy) < LOOK_RANGE_PT) {
        // (y axis) Mac: y = -dy / 220 with dy up; here dy already points down.
        input.lookTarget = {
          x: clamp(dx / LOOK_SATURATION_PT, -1, 1),
          y: clamp(dy / LOOK_SATURATION_PT, -1, 1),
        };
      }
    }
    const scene = Animator.scene(input);
    // Ease between activities so arms, height and lean never snap (knocking stays crisp).
    if (this._mode === "idle" && this.lastPose !== null) {
      scene.pose = this.lastPose.eased(scene.pose, 1 - Math.exp(-dt / 0.07));
    }
    this.lastPose = scene.pose;
    const l10n = this.prefs.l10n;
    scene.knockText = l10n.t("knockWord");
    if (this._mode === "idle") scene.hint = this.hint;
    const b = this.bubbleText;
    if (b !== null && (this._mode === "alert" || this._mode === "approaching")) {
      scene.bubble = new Bubble(b.title, b.subtitle, l10n.isRTL, smooth((t - this.alertStart - 0.75) / 0.25));
      // Windows addition: at desktop size the Mac bubble text is ~8 px; scale it like the hint.
      if (this.prefs.knockStyle === "inPlace") scene.bubble.scale = IN_PLACE_BUBBLE_SCALE;
    }
    return scene;
  }

  /// The frame rate follows what's happening: 60 while animating / carried / falling, 30 for lively activities,
  /// 12 sitting, 8 asleep.
  desiredFPS(): number {
    if (this.animation !== null || this._mode !== "idle" || this.dragging || this.falling || this.pressing) return 60;
    if (this.hearts.length > 0) return 30;
    switch (this.brain.activity) {
      case "walk":
      case "jump":
      case "dance":
      case "wave":
      case "yawn":
      case "dangle":
      case "fall":
        return 30;
      case "sleep":
        return 8;
      case "sit":
      case "lookAround":
      case "meditate":
      case "laptop":
        return 12;
      case "kata":
      case "kick":
      case "shuriken":
      case "sword":
        return 30;
    }
  }

  private scheduleClock(fps: number): void {
    if (fps === this.clockFPS) return;
    this.debug(`fps ${this.clockFPS} → ${fps}  mode=${this._mode} activity=${this.brain.activity}`);
    this.clockFPS = fps;
    // Timer.invalidate + a new repeating timer: the next frame is due in 1 / fps.
    if (this.clockTimer !== null) this.scheduler.clear(this.clockTimer);
    this.nextDueMs = this.clockNowMs() + 1000 / fps;
    this.clockTimer = this.scheduler.set(() => this.onClock(), 1000 / fps);
  }

  private onClock(): void {
    this.clockTimer = null;
    void this.tick().finally(() => {
      if (this.clockTimer === null && !this.stopped && this.clockFPS > 0) this.armNext();
    });
  }

  /// The next frame, on the fixed grid of the current rate (a late frame does not make the following ones burst).
  private armNext(): void {
    const interval = 1000 / this.clockFPS;
    const nowMs = this.clockNowMs();
    this.nextDueMs += interval;
    let delay = this.nextDueMs - nowMs;
    if (delay < 0) {
      this.nextDueMs = nowMs;
      delay = 0;
    }
    this.clockTimer = this.scheduler.set(() => this.onClock(), delay);
  }

  // MARK: geometry

  private animate(to: Rect, duration: number, overshoot: boolean, hop: number, scale: number, done: () => void): void {
    this.animation = { from: { ...this.current }, to, start: this.now, duration, overshoot, hop, scale, done };
    this.scheduleClock(60);
  }

  /// Sets the window frame and tells Win32 (rounded to whole pixels).
  private applyFrame(r: Rect): void {
    this.current = r;
    this.platform.setFrame(roundRect(r));
  }

  /// On the floor (just above the taskbar), at `centerX`.
  private idleFrame(): Rect {
    return idleFrame(this.monitors, this.prefs.size, this.centerX);
  }

  /// Big and centered on the screen with the cursor -- right up against the glass.
  private alertScreenAndFrame(): { monitor: MonitorInfo; frame: Rect } {
    const monitor = alertScreen(this.monitors, this.pointer);
    return { monitor, frame: alertFrame(monitor) };
  }

  private skin(): Skin {
    let s = this.skins.get(this.skinID);
    if (s === undefined) {
      s = skinFor(this.skinID);
      this.skins.set(this.skinID, s);
    }
    return s;
  }

  private debug(line: string): void {
    this.log?.(line);
  }
}

function fmt(r: Rect): string {
  return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`;
}
