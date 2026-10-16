// port of Tests/BuddyCoreTests/BrainTests.swift (BrainTests + AnimatorTests)

import { describe, expect, it } from "vitest";
import { Animator, AnimationInput, Knocking, PostureTracker } from "./animation";
import { Brain, BrainContext } from "./brain";
import type { Activity, Mischief } from "./brain";
import { Pose } from "./pose";

describe("BrainTests", () => {
  /// Runs the brain for `seconds` at 20 ticks/s, moving x by the returned velocity. Returns the final x.
  function run(
    brain: Brain,
    seconds: number,
    mischief: Mischief,
    x: number,
    userIdle: (now: number) => number = () => 0,
    visit: (a: Activity) => void = () => {},
  ): number {
    let now = 0.0;
    while (now < seconds) {
      const v = brain.tick(
        new BrainContext({ now, x, minX: 100, maxX: 1500, userIdle: userIdle(now), mischief }),
      );
      x = Math.min(1500, Math.max(100, x + v * 0.05));
      visit(brain.activity);
      now += 0.05;
    }
    return x;
  }

  it("calmBuddiesNeverWalk", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const brain = new Brain(seed);
      let walked = false;
      const x = run(brain, 300, "calm", 800.0, undefined, (a) => {
        if (a === "walk") walked = true;
      });
      expect(walked).toBe(false);
      expect(x).toBe(800);
    }
  });

  it("playfulBuddiesWanderAndStayOnScreen", () => {
    const brain = new Brain(7);
    const seen = new Set<Activity>();
    const x = run(brain, 600, "playful", 800.0, undefined, (a) => {
      seen.add(a);
    });
    expect(seen.has("walk")).toBe(true);
    expect(seen.has("sit")).toBe(true);
    expect(x >= 100 && x <= 1500).toBe(true);
  });

  it("sleepsWhenHumanIsAwayAndWakesWithAYawn", () => {
    const brain = new Brain(3);
    const x = run(brain, 200, "playful", 800.0, (now) => now);
    expect(brain.activity).toBe("sleep");
    brain.tick(new BrainContext({ now: 201, x, minX: 100, maxX: 1500, userIdle: 0 }));
    expect(brain.activity).toBe("yawn");
  });

  it("wavesWhenTheCursorComesClose", () => {
    const brain = new Brain(1);
    brain.tick(
      new BrainContext({ now: 0, x: 500, minX: 0, maxX: 1000, mouse: { x: 40, y: 30 }, mouseMovedAgo: 0.1 }),
    );
    expect(brain.activity).toBe("wave");
  });

  it("pokingASleepyBuddyWakesIt", () => {
    const brain = new Brain(1);
    run(brain, 200, "calm", 800.0, (now) => now);
    brain.poke(200);
    expect(brain.activity).toBe("yawn");
    brain.poke(203);
    expect(brain.activity).toBe("jump");
  });

  it("carriedBuddyIgnoresTheBrain", () => {
    const brain = new Brain(1);
    brain.pickUp(0);
    expect(brain.tick(new BrainContext({ now: 50, x: 0, minX: 0, maxX: 10, userIdle: 999 }))).toBe(0);
    expect(brain.activity).toBe("dangle");
  });
});

describe("AnimatorTests", () => {
  it("knockingRaisesTheArmAndPressesTheGlass", () => {
    const input = new AnimationInput(100);
    input.mode = "alert";
    input.knockHits = Knocking.schedule(1.0);
    input.alertElapsed = 1.0; // exactly on the first hit
    const s = Animator.scene(input);
    expect(s.pose.reach).toBeGreaterThan(0.9);
    expect(s.pose.rightArmInFront).toBe(true);
    expect(s.pose.press).toBeGreaterThan(2);
    expect(s.knockAges).toEqual([0]);
  });

  it("sleepingClosesEyes", () => {
    const input = new AnimationInput(5);
    input.activity = "sleep";
    const s = Animator.scene(input);
    expect(s.sleeping).toBe(true);
    expect(s.pose.eyeOpen).toBe(0);
    expect(s.pose.mood).toBe("sleepy");
  });

  it("walkingSteps", () => {
    const input = new AnimationInput(5);
    input.activity = "walk";
    input.activityElapsed = 0.3;
    input.direction = -1;
    const p = Animator.scene(input).pose;
    expect(p.stepPhase).not.toBeNull();
    expect(p.lean).toBeLessThan(0);
    expect(p.footLift(true) > 0 || p.footLift(false) > 0).toBe(true);
  });

  it("pattingMakesItHappy", () => {
    const input = new AnimationInput(5);
    input.heartAges = [0.3];
    expect(Animator.scene(input).pose.mood).toBe("happy");
  });

  it("posturesFollowActivities", () => {
    function posture(a: Activity, e = 2): Pose {
      const input = new AnimationInput(5);
      input.activity = a;
      input.activityElapsed = e;
      return Animator.scene(input).pose;
    }
    expect(posture("sit").posture).toBe("sit");
    expect(posture("walk").posture).toBe("stand");
    expect(posture("sleep").posture).toBe("lie");
    expect(posture("yawn").posture).toBe("stretch");
    expect(posture("dangle").airborne).toBe(true);
    expect(posture("walk", 0).postureBlend).toBe(0); // starts blending from sitting
  });

  it("knockingTurnsToFaceTheViewer", () => {
    const input = new AnimationInput(5);
    input.mode = "alert";
    input.alertElapsed = 2;
    input.direction = -1;
    const p = Animator.scene(input).pose;
    expect(p.posture === "front" && p.postureBlend === 1).toBe(true);
    expect(p.facing).toBe(-1);
  });

  it("postureTrackerStartsFromWhereTheBodyIs", () => {
    const tracker = new PostureTracker();
    // sitting → looking around (also sitting): no transition at all
    tracker.update("sit", 0.35, 0);
    expect(tracker.blend(0.01)).toBe(1);
    // sit → stand → back to sit before standing finished: start from sit, not stand
    tracker.update("stand", 0.3, 1);
    tracker.update("sit", 0.35, 1.05);
    expect(tracker.state(1.05).from).toBe("sit");
    // fully standing → lie: starts from stand
    tracker.update("stand", 0.3, 2);
    tracker.update("lie", 0.8, 3);
    expect(tracker.state(3).from).toBe("stand");
  });

  it("easingRemovesSnaps", () => {
    const a = new Pose();
    a.lift = -20;
    a.leftArm = 150;
    const b = new Pose();
    const half = a.eased(b, 0.5);
    expect(half.lift).toBe(-10);
    expect(half.leftArm).toBe((150 + 14) / 2);
  });
});

// Windows additions (Pooria, 2026-10-15)
describe("WindowsExtras", () => {
  const extras = ["meditate", "kata", "kick", "shuriken", "sword"] as const;
  it("specialMovesNeverFollowEachOther", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const brain = new Brain(BigInt(seed));
      let x = 800;
      let prev = brain.activity;
      const counts: Record<string, number> = {};
      for (let now = 0; now < 600; now += 0.05) {
        const v = brain.tick(new BrainContext({ now, x, minX: 100, maxX: 1500, mischief: "naughty", extras }));
        x = Math.min(1500, Math.max(100, x + v * 0.05));
        const a = brain.activity;
        if (a !== prev) {
          counts[a] = (counts[a] ?? 0) + 1;
          const isExtra = (s: string): boolean => (extras as readonly string[]).includes(s);
          expect(isExtra(prev) && isExtra(a)).toBe(false);
          prev = a;
        }
      }
      expect(counts["walk"] ?? 0).toBeGreaterThan(counts["meditate"] ?? 0);
    }
  });

  it("skippedActivitiesAreNeverPicked", () => {
    const brain = new Brain(BigInt(7));
    let x = 800;
    for (let now = 0; now < 1200; now += 0.05) {
      const v = brain.tick(new BrainContext({ now, x, minX: 100, maxX: 1500, mischief: "naughty", extras, skips: ["dance"] }));
      x = Math.min(1500, Math.max(100, x + v * 0.05));
      expect(brain.activity).not.toBe("dance");
    }
  });
});
