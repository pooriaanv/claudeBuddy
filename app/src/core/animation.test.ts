import { describe, expect, it } from "vitest";
import { AnimationInput, Animator, Impatience, Knocking } from "./animation";

// Windows addition (Pooria, 2026-10-21): the impatient knock.
describe("Knocking.impatient", () => {
  const plan = Knocking.impatient(1.0);
  const times = (kind: string): number[] => plan.hits.filter((_, i) => plan.kinds[i] === kind);

  it("knocksThenRocksThenSlamsThenCracks", () => {
    const knocks = times("knock");
    const stomps = times("stomp");
    const claps = times("clap");
    const slams = times("slam");
    expect(knocks[0]).toBe(1.0);
    expect(Math.max(...knocks)).toBeLessThan(20);
    // the rhythm starts ~20 s in and lasts 15 s: stomp, stomp, clap, at 81 bpm eighths
    expect(stomps[0]).toBeCloseTo(1.0 + Impatience.KNOCK_SECONDS, 5);
    const beat = 60 / Impatience.BPM / 2;
    expect(stomps[1] - stomps[0]).toBeCloseTo(beat, 5);
    expect(claps[0] - stomps[0]).toBeCloseTo(2 * beat, 5);
    expect(stomps.length).toBe(2 * claps.length);
    expect(Math.max(...claps)).toBeLessThan(stomps[0] + Impatience.ROCK_SECONDS);
    expect(slams.length).toBe(Impatience.SLAMS);
    expect(slams[0]).toBeGreaterThan(Math.max(...claps));
    expect(plan.crackAt).toBe(slams[slams.length - 1]);
  });

  it("hitsAreInOrderAndComeInThrees", () => {
    for (let i = 1; i < plan.hits.length; i++) expect(plan.hits[i]).toBeGreaterThan(plan.hits[i - 1]);
    // Knocking.state raises the arm per group of three hits
    expect(plan.hits.length % 3).toBe(0);
  });

  it("theCrackShowsOnTheSceneWithASurprisedBuddy", () => {
    const input = new AnimationInput(50);
    input.mode = "alert";
    input.alertElapsed = plan.crackAt + 1;
    input.knockHits = plan.hits;
    input.knockKinds = plan.kinds;
    input.crackAge = 1;
    const scene = Animator.scene(input);
    expect(scene.crackAge).toBe(1);
    expect(scene.pose.mood).toBe("surprised");
  });

  it("aClapShowsItsWord", () => {
    const input = new AnimationInput(30);
    input.mode = "alert";
    input.alertElapsed = times("clap")[0] + 0.05;
    input.knockHits = plan.hits;
    input.knockKinds = plan.kinds;
    expect(Animator.scene(input).knockWords).toContain("CLAP!");
  });
});
