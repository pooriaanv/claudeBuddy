import { describe, expect, it } from "vitest";
import { AnimationInput, Animator, Impatience, Knocking } from "./animation";

// Windows addition (Pooria, 2026-10-21): the impatient knock.
describe("Knocking.impatient", () => {
  const plan = Knocking.impatient(1.0);
  const times = (kind: string): number[] => plan.hits.filter((_, i) => plan.kinds[i] === kind);

  it("knocksThenRocksPausesKnocksSlamsCracksAndGivesUp", () => {
    const knocks = times("knock");
    const stomps = times("stomp");
    const claps = times("clap");
    const slams = times("slam");
    expect(knocks[0]).toBe(1.0);
    // the ordinary cycles as before: 3.2 s apart three times, then 12 s
    expect(knocks[3] - knocks[0]).toBeCloseTo(3.2, 5);
    expect(knocks[12] - knocks[9]).toBeCloseTo(12, 5);
    // the rhythm starts at the next cycle after ~45 s and lasts 15 s: stomp, stomp, clap, at 81 bpm eighths
    expect(stomps[0]).toBeGreaterThanOrEqual(1.0 + Impatience.CALM_SECONDS);
    const beat = 60 / Impatience.BPM / 2;
    expect(stomps[1] - stomps[0]).toBeCloseTo(beat, 5);
    expect(claps[0] - stomps[0]).toBeCloseTo(2 * beat, 5);
    const rockEnd = stomps[0] + Impatience.ROCK_SECONDS;
    expect(Math.max(...claps)).toBeLessThan(rockEnd);
    // a pause, then ordinary knocks again for a few seconds, then ten slams
    const again = knocks.filter((k) => k > rockEnd);
    expect(again[0]).toBeCloseTo(rockEnd + Impatience.PAUSE_SECONDS, 5);
    expect(Math.max(...again)).toBeLessThan(again[0] + Impatience.KNOCK_AGAIN_SECONDS);
    expect(slams.length).toBe(Impatience.SLAMS);
    expect(slams[0]).toBeGreaterThan(Math.max(...again));
    expect(plan.crackAt).toBe(slams[slams.length - 1]);
    expect(plan.giveUpAt).toBe(plan.crackAt + Impatience.CRACK_SECONDS);
  });

  it("hitsAreInOrderAndComeInThrees", () => {
    for (let i = 1; i < plan.hits.length; i++) expect(plan.hits[i]).toBeGreaterThan(plan.hits[i - 1]);
    // the last slam (ten is not a multiple of three) still raises the arm
    expect(Knocking.state(plan.crackAt, plan.hits).armUp).toBeGreaterThan(0.5);
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
