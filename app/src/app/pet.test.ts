import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Brain } from "../core/brain";
import type { Activity } from "../core/brain";
import { PetScene } from "../core/pose";
import { alertFrame, idleFrame } from "./geometry";
import type { MonitorInfo, Rect } from "./geometry";
import { PetController } from "./pet";
import type { PetPlatform, Scheduler } from "./pet";
import { Preferences } from "./prefs";
import type { KeyValueStore } from "./prefs";
import type { PetLevel, PointerState } from "./types";

const dev: MonitorInfo = { x: 0, y: 0, width: 3440, height: 1440, workArea: { x: 0, y: 0, width: 3440, height: 1392 }, scale: 1 };
const hiDpi: MonitorInfo = { x: 0, y: 0, width: 2560, height: 1440, workArea: { x: 0, y: 0, width: 2560, height: 1392 }, scale: 1.5 };

class MemoryStore implements KeyValueStore {
  data = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

class FakePlatform implements PetPlatform {
  pointer: PointerState = { x: 0, y: 0, leftDown: false, idleSecs: 0 };
  frames: Rect[] = [];
  levels: PetLevel[] = [];
  draws = 0;
  async pointerState(): Promise<PointerState> {
    return { ...this.pointer };
  }
  setFrame(f: Rect): void {
    this.frames.push(f);
  }
  setLevel(l: PetLevel): void {
    this.levels.push(l);
  }
  dropLevel(_x: number, _y: number): void {
    this.levels.push("dropped" as PetLevel);
  }
  draw(_scene: PetScene): void {
    this.draws += 1;
  }
}

function harness(opts: { monitors?: MonitorInfo[]; stored?: Record<string, unknown>; seed?: number } = {}) {
  const clock = { s: 1000 };
  const platform = new FakePlatform();
  const prefs = new Preferences(new MemoryStore(), opts.stored ?? {});
  const timers: { ms: number }[] = [];
  const scheduler: Scheduler = {
    set: (_fn, ms) => timers.push({ ms }),
    clear: () => {},
  };
  const logs: string[] = [];
  const monitors = opts.monitors ?? [dev];
  const pet = new PetController({
    prefs,
    platform,
    monitors,
    now: () => clock.s,
    nowMs: () => clock.s * 1000,
    scheduler,
    log: (l) => logs.push(l),
    brain: new Brain(opts.seed ?? 7),
  });
  const step = async (dt: number): Promise<void> => {
    clock.s += dt;
    await pet.tick();
  };
  const run = async (seconds: number, fps: number, each?: () => void): Promise<void> => {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) {
      await step(1 / fps);
      each?.();
    }
  };
  const floor = idleFrame(monitors, prefs.size, prefs.petX ?? monitors[0].workArea.x + monitors[0].workArea.width - 120 * monitors[0].scale);
  return { pet, platform, prefs, clock, timers, logs, step, run, floor, monitors };
}

describe("PetController (port of PetController.swift, physical px, y down)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts on the floor at the right side, sitting, at 12 fps", async () => {
    const h = harness();
    await h.pet.start();
    expect(h.platform.frames[0]).toEqual({ x: 3245, y: 1199, w: 150, h: 200 });
    expect(h.platform.draws).toBe(1);
    expect(h.pet.mode).toBe("idle");
    expect(h.pet.activity).toBe("sit");
    expect(h.timers[h.timers.length - 1].ms).toBeCloseTo(1000 / 12, 6);
    expect(h.logs.some((l) => l.startsWith("fps 0 → 12"))).toBe(true);
  });

  it("uses the saved petX and the size pref; at 150 % the window is 225 x 300 px", async () => {
    const h = harness({ monitors: [hiDpi], stored: { petX: 1000, size: 200 } });
    await h.pet.start();
    expect(h.platform.frames[0]).toEqual({ x: 1000 - 150, y: 1392 + Math.round(400 * 0.035) - 400, w: 300, h: 400 });
    const g = harness({ monitors: [hiDpi] });
    await g.pet.start();
    expect([g.platform.frames[0].w, g.platform.frames[0].h]).toEqual([225, 300]);
  });

  it("click on the pet: hearts, a jump, 30 fps, onPetted", async () => {
    const h = harness();
    let petted = 0;
    h.pet.onPetted = () => petted++;
    await h.pet.start();
    h.pet.clicked();
    await h.step(0.01);
    expect(petted).toBe(1);
    expect(h.pet.activity).toBe("jump");
    expect(h.pet.lastScene.heartAges.length).toBe(1);
    expect(h.pet.desiredFPS()).toBe(30);
    await h.run(1.7, 30);
    expect(h.pet.lastScene.heartAges.length).toBe(0); // hearts are gone after 1.6 s
  });

  it("drag: dangles while held, falls with gravity when let go above the floor, lands with a hop", async () => {
    const h = harness();
    await h.pet.start();
    h.platform.pointer = { x: 3320, y: 1300, leftDown: true, idleSecs: 0 };
    await h.step(1 / 12);
    h.pet.dragBegan();
    h.pet.dragMoved({ x: 3120, y: 1100 }, { x: 75, y: 100 });
    expect(h.pet.frame()).toEqual({ x: 3045, y: 1000, w: 150, h: 200 });
    await h.step(1 / 60);
    expect(h.pet.activity).toBe("dangle");
    expect(h.pet.desiredFPS()).toBe(60);
    h.pet.dragEnded();
    expect(h.prefs.petX).toBe(3120);
    const ys: number[] = [];
    let landedAfter = -1;
    for (let i = 1; i <= 120 && landedAfter < 0; i++) {
      await h.step(1 / 60);
      ys.push(h.pet.frame().y);
      if (h.pet.frame().y === h.floor.y) landedAfter = i;
    }
    expect(landedAfter).toBeGreaterThan(0);
    // free fall: y(n) ~ y0 + g dt^2 n(n+1)/2 with g = 2600 px/s^2 (scale 1)
    const n = 20;
    expect(ys[n - 1]).toBeCloseTo(1000 + (2600 / 3600) * ((n * (n + 1)) / 2), -1);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
    expect(h.pet.activity).toBe("jump"); // landed: brain.land
    expect(h.pet.frame().x).toBe(3045); // falls straight down
  });

  it("dropping within 2 pt of the floor does not fall", async () => {
    const h = harness();
    await h.pet.start();
    h.pet.dragBegan();
    h.pet.dragMoved({ x: 3320, y: 1300 }, { x: 75, y: 101 }); // y = 1199: on the floor
    h.pet.dragEnded();
    expect(h.pet.activity).toBe("jump");
    await h.step(1 / 60);
    expect(h.pet.frame().y).toBe(1199);
  });

  it("the fall speed follows the monitor scale (same pt height, same number of frames)", async () => {
    const frames = async (m: MonitorInfo): Promise<number> => {
      const h = harness({ monitors: [m] });
      await h.pet.start();
      h.pet.dragBegan();
      const s = m.scale;
      h.pet.dragMoved({ x: h.floor.x + 75 * s, y: h.floor.y - 300 * s + 100 * s }, { x: 75 * s, y: 100 * s });
      h.pet.dragEnded();
      for (let i = 1; i < 300; i++) {
        await h.step(1 / 60);
        if (h.pet.frame().y === h.floor.y) return i;
      }
      return -1;
    };
    const a = await frames(dev);
    const b = await frames(hiDpi);
    expect(a).toBeGreaterThan(10);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it("knock: goes to the front, grows to the alert frame, goes home behind the windows", async () => {
    const h = harness();
    await h.pet.start();
    h.platform.pointer = { x: 1500, y: 700, leftDown: false, idleSecs: 0 };
    await h.step(1 / 12);
    const ys: number[] = [];
    h.pet.knock("Claude is done!", "waiting for you");
    expect(h.platform.levels).toEqual(["front"]);
    expect(h.pet.mode).toBe("approaching");
    await h.run(1.2, 60, () => ys.push(h.pet.frame().y));
    expect(h.pet.mode).toBe("alert");
    expect(h.pet.frame()).toEqual({ x: 1504, y: 408, w: 432, h: 576 });
    expect(h.pet.frame()).toEqual({ ...alertFrame(dev), x: Math.round(alertFrame(dev).x) });
    expect(Math.min(...ys)).toBeLessThan(408); // ease-out-back overshoots the target
    expect(h.pet.lastScene.bubble?.title).toBe("Claude is done!");
    expect(h.pet.desiredFPS()).toBe(60);
    expect(h.platform.levels).toEqual(["front"]); // stays in front until it is home

    h.pet.knock("a second one", "x"); // while alerting: only the bubble and the schedule change
    expect(h.platform.levels).toEqual(["front"]);
    expect(h.pet.mode).toBe("alert");

    h.pet.goHome();
    expect(h.pet.mode).toBe("leaving");
    expect(h.platform.levels).toEqual(["front"]); // the level drops after the leave animation, like Mac
    await h.run(0.8, 60);
    expect(h.pet.mode).toBe("idle");
    expect(h.platform.levels).toEqual(["front", "desktop"]);
    expect(h.pet.frame()).toEqual(h.floor);
    expect(h.pet.activity).toBe("jump");
    h.pet.goHome(); // not knocking: ignored
    expect(h.pet.mode).toBe("idle");
  });

  it("a click while knocking asks for dismissal instead of hearts", async () => {
    const h = harness();
    let dismissed = 0;
    h.pet.onDismissRequested = () => dismissed++;
    await h.pet.start();
    h.pet.knock("t", "s");
    h.pet.clicked();
    expect(dismissed).toBe(1);
    await h.step(0.01);
    expect(h.pet.lastScene.heartAges).toEqual([]);
    expect(h.pet.canDrag()).toBe(false);
  });

  it("Calm never walks (120 s)", async () => {
    const h = harness({ stored: { mischief: "calm" } });
    await h.pet.start();
    const seen = new Set<Activity>();
    await h.run(120, 12, () => seen.add(h.pet.activity));
    expect(seen.has("walk")).toBe(false);
    expect(new Set(h.platform.frames.map((f) => f.x))).toEqual(new Set([3245]));
  });

  it("Playful walks around and stays inside the work area", async () => {
    const h = harness({ stored: { mischief: "playful" }, seed: 3 });
    await h.pet.start();
    const seen = new Set<Activity>();
    let minX = Infinity;
    let maxX = -Infinity;
    await h.run(300, 30, () => {
      seen.add(h.pet.activity);
      minX = Math.min(minX, h.pet.frame().x);
      maxX = Math.max(maxX, h.pet.frame().x + h.pet.frame().w);
    });
    expect(seen.has("walk")).toBe(true);
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(3440);
    expect(minX).toBeLessThan(3245); // it actually moved left of the start
  });

  it("walking speed is 40 pt/s times the scale", async () => {
    const h = harness({ monitors: [hiDpi], stored: { mischief: "naughty" }, seed: 5 });
    await h.pet.start();
    // find a walking stretch and measure px/s
    let measured = 0;
    let prevX = h.pet.frame().x;
    let t0 = 0;
    for (let i = 0; i < 6000 && measured === 0; i++) {
      await h.step(1 / 30);
      if (h.pet.activity === "walk") {
        if (t0 === 0) {
          t0 = h.clock.s;
          prevX = h.pet.frame().x;
        } else if (h.clock.s - t0 >= 1.5) {
          measured = Math.abs(h.pet.frame().x - prevX) / (h.clock.s - t0);
        }
      } else {
        t0 = 0;
      }
    }
    expect(measured).toBeGreaterThan(0);
    // naughty = 60 pt/s -> 90 px/s at 150 %
    expect(measured).toBeGreaterThan(80);
    expect(measured).toBeLessThan(100);
  });

  it("falls asleep after 150 s without input (Playful), zZ, 8 fps; wakes with a yawn", async () => {
    const h = harness();
    await h.pet.start();
    h.platform.pointer = { x: 0, y: 0, leftDown: false, idleSecs: 151 };
    await h.step(1 / 12);
    expect(h.pet.activity).toBe("sleep");
    expect(h.pet.lastScene.sleeping).toBe(true);
    expect(h.pet.desiredFPS()).toBe(8);
    h.platform.pointer = { x: 5, y: 5, leftDown: false, idleSecs: 0.2 };
    await h.step(1 / 8);
    expect(h.pet.activity).toBe("yawn");
    expect(h.pet.desiredFPS()).toBe(30);
    // Calm sleeps already after 90 s
    const c = harness({ stored: { mischief: "calm" } });
    await c.pet.start();
    c.platform.pointer = { x: 0, y: 0, leftDown: false, idleSecs: 91 };
    await c.step(1 / 12);
    expect(c.pet.activity).toBe("sleep");
  });

  it("the eyes follow the cursor within 450 pt (y down: cursor below = look down)", async () => {
    const h = harness();
    await h.pet.start();
    const head = { x: 3245 + 75, y: 1199 + 100 };
    // 215 px away: outside the 170 pt wave radius, inside the 450 pt look radius
    h.platform.pointer = { x: head.x - 200, y: head.y + 80, leftDown: false, idleSecs: 0 };
    await h.run(1.5, 12); // still sitting (the first settle lasts 4 s)
    expect(h.pet.activity).toBe("sit");
    expect(h.pet.lastScene.pose.look.x).toBeCloseTo(-200 / 220, 2);
    expect(h.pet.lastScene.pose.look.y).toBeCloseTo(80 / 220, 2);
    // beyond 450 px: wandering eyes (|x| < 1), not the cursor
    h.platform.pointer = { x: head.x - 600, y: head.y, leftDown: false, idleSecs: 0 };
    await h.run(0.5, 12);
    expect(Math.abs(h.pet.lastScene.pose.look.x)).toBeLessThan(0.9);
    // saturates at +-1 beyond 220 pt
    h.platform.pointer = { x: head.x + 400, y: head.y, leftDown: false, idleSecs: 0 };
    await h.run(1.5, 12);
    expect(h.pet.activity).toBe("sit");
    expect(h.pet.lastScene.pose.look.x).toBeCloseTo(1, 2);
  });

  it("frame-rate tiers: 12 sitting, 30 walking, 60 while a button is held", async () => {
    const h = harness({ stored: { mischief: "naughty" }, seed: 11 });
    await h.pet.start();
    const fps = new Set<number>();
    await h.run(120, 30, () => fps.add(h.pet.desiredFPS()));
    expect(fps.has(12)).toBe(true);
    expect(fps.has(30)).toBe(true);
    h.pet.pressChanged(true);
    expect(h.pet.desiredFPS()).toBe(60);
    expect(h.timers[h.timers.length - 1].ms).toBeCloseTo(1000 / 60, 6);
    h.pet.pressChanged(false);
  });

  it("screens changed: re-placed on the floor of the new work area", async () => {
    const h = harness();
    await h.pet.start();
    h.pet.screensChanged([{ ...dev, workArea: { x: 0, y: 0, width: 3440, height: 1344 } }]); // taller taskbar
    expect(h.pet.frame().y + h.pet.frame().h).toBe(1344 + 7);
  });

  it("relayout applies a new size and skin", async () => {
    const h = harness();
    await h.pet.start();
    h.prefs.size = 200;
    h.pet.relayout();
    expect(h.pet.frame().w).toBe(200);
    expect(h.pet.frame().h).toBe(267);
  });

  it("feeds every pointer sample to the input layer", async () => {
    const h = harness();
    const seen: PointerState[] = [];
    h.pet.onPointerState = (ps) => seen.push(ps);
    h.platform.pointer = { x: 12, y: 34, leftDown: true, idleSecs: 5 };
    await h.pet.start();
    expect(seen).toEqual([{ x: 12, y: 34, leftDown: true, idleSecs: 5 }]);
  });
});
