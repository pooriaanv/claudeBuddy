import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PET_X_SAVE_INTERVAL_MS, PREF_DEFAULTS, Preferences, SIZE_MAX, SIZE_MIN, parsePref } from "./prefs";
import type { KeyValueStore } from "./prefs";

class FakeStore implements KeyValueStore {
  data = new Map<string, unknown>();
  sets: [string, unknown][] = [];
  private cb: ((key: string, value: unknown) => void) | null = null;
  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    this.sets.push([key, value]);
    this.cb?.(key, value); // the plugin echoes our own writes back
  }
  async onChange(cb: (key: string, value: unknown) => void): Promise<() => void> {
    this.cb = cb;
    return () => {
      this.cb = null;
    };
  }
  /// What the Settings window writing the store looks like to this window.
  external(key: string, value: unknown): void {
    this.data.set(key, value);
    this.cb?.(key, value);
  }
}

describe("Preferences", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an empty store gives the Mac defaults", async () => {
    const p = await Preferences.load(new FakeStore());
    expect(p.skin).toBe("buddy");
    expect(p.language).toBe("system");
    expect(p.mischief).toBe("playful");
    expect(p.soundOn).toBe(true);
    expect(p.size).toBe(150);
    expect(p.quietWhenWatching).toBe(false);
    expect(p.autoUpdate).toBe(true);
    expect(p.petX).toBeNull();
    expect(PREF_DEFAULTS.size).toBe(150);
  });

  it("stored values are read; unknown or wrongly typed ones fall back to the defaults", async () => {
    const s = new FakeStore();
    s.data.set("skin", "cyberNinja");
    s.data.set("mischief", "naughty");
    s.data.set("language", "klingon");
    s.data.set("soundOn", "yes");
    s.data.set("size", 9999);
    s.data.set("petX", 1234.5);
    const p = await Preferences.load(s);
    expect(p.skin).toBe("cyberNinja");
    expect(p.mischief).toBe("naughty");
    expect(p.language).toBe("system");
    expect(p.soundOn).toBe(true);
    expect(p.size).toBe(SIZE_MAX);
    expect(p.petX).toBe(1234.5);
    expect(parsePref("size", 10)).toBe(SIZE_MIN);
    expect(parsePref("size", Number.NaN)).toBe(150);
    expect(parsePref("skin", 3)).toBe("buddy");
  });

  it("a setter persists and notifies once; the same value does nothing", async () => {
    const s = new FakeStore();
    const p = await Preferences.load(s);
    const seen: string[] = [];
    p.onChange((k) => seen.push(k));
    p.skin = "kitty";
    p.skin = "kitty";
    p.mischief = "calm";
    await Promise.resolve();
    expect(seen).toEqual(["skin", "mischief"]);
    expect(s.data.get("skin")).toBe("kitty");
    expect(s.data.get("mischief")).toBe("calm");
    expect(p.skin).toBe("kitty");
  });

  it("changes made by another window are applied and announced (own writes echoing back are not)", async () => {
    const s = new FakeStore();
    const p = await Preferences.load(s);
    const seen: string[] = [];
    p.onChange((k) => seen.push(k));
    p.size = 200; // our write comes back through onChange
    expect(seen).toEqual(["size"]);
    s.external("skin", "ninja");
    s.external("size", 120);
    s.external("petX", 5);
    expect(p.skin).toBe("ninja");
    expect(p.size).toBe(120);
    expect(seen).toEqual(["size", "skin", "size"]);
    expect(p.petX).toBeNull(); // only the pet writes petX
  });

  it("petX is written at most once per interval, immediately on flush, and never notifies", async () => {
    const s = new FakeStore();
    const p = await Preferences.load(s);
    const seen: string[] = [];
    p.onChange((k) => seen.push(k));
    for (let i = 0; i < 30; i++) p.petX = 1000 + i;
    expect(p.petX).toBe(1029);
    expect(s.sets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(PET_X_SAVE_INTERVAL_MS);
    expect(s.sets).toEqual([["petX", 1029]]);
    p.petX = 2000;
    await p.flushPetX();
    expect(s.sets).toEqual([
      ["petX", 1029],
      ["petX", 2000],
    ]);
    await vi.advanceTimersByTimeAsync(PET_X_SAVE_INTERVAL_MS * 2);
    expect(s.sets).toHaveLength(2); // nothing left to write
    expect(seen).toEqual([]);
  });

  it("l10n follows the language preference", async () => {
    const p = await Preferences.load(new FakeStore());
    p.language = "fa";
    expect(p.l10n.isRTL).toBe(true);
    expect(p.l10n.t("knockWord")).toBe("تق!");
    p.language = "en";
    expect(p.l10n.t("knockWord")).toBe("Knock!");
  });
});
