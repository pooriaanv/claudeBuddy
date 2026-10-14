// port of Sources/ClaudeBuddy/Preferences.swift (Mac reference v0.0.9) -- 12-windows-plan.md D14, 08-ui-tray-settings.md.
//
// Stored with tauri-plugin-store in `prefs.json` (app data dir). Same keys and defaults as the Mac UserDefaults.
// `petX` (last horizontal center on the floor) is stored in PHYSICAL pixels (D5). Every window that opens the store
// sees changes made by the others (`store.onChange`), so the pet applies Settings changes live.

import { MISCHIEFS } from "../core/brain";
import type { Mischief } from "../core/brain";
import { L10n, LANGUAGES } from "../core/localization";
import type { Language } from "../core/localization";
import { SKIN_IDS } from "../core/pose";
import type { SkinID } from "../core/pose";

/// The slice of `Store` (tauri-plugin-store) that `Preferences` needs; a fake in tests.
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /// Subscribes to changes of any key, from any window; resolves to the unsubscribe function.
  onChange?(cb: (key: string, value: unknown) => void): Promise<() => void>;
}

/// The published settings (Swift `@Published` properties).
export interface PrefValues {
  skin: SkinID;
  language: Language;
  mischief: Mischief;
  soundOn: boolean;
  /// Width of the buddy window while on the desktop, in points.
  size: number;
  /// Don't knock for a session whose app you're already looking at. Off by default.
  quietWhenWatching: boolean;
  autoUpdate: boolean;
  /// Windows addition (Pooria, 2026-10-15): "center" = come to the middle of the screen, big (Mac); "inPlace" = knock
  /// where it is, same size, just above every window.
  knockStyle: KnockStyle;
}

export type KnockStyle = "center" | "inPlace";

export type PrefKey = keyof PrefValues;

export const PREF_DEFAULTS: Readonly<PrefValues> = {
  skin: "buddy",
  language: "system",
  mischief: "playful",
  soundOn: true,
  size: 150,
  quietWhenWatching: false,
  autoUpdate: true,
  knockStyle: "center",
};

export const PREF_KEYS = Object.keys(PREF_DEFAULTS) as PrefKey[];

/// 08: the Size slider runs 110...230 pt.
export const SIZE_MIN = 110;
export const SIZE_MAX = 230;

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

/// Validates one stored value; anything unknown or of the wrong type falls back to the default
/// (Swift: `SkinID(rawValue: defaults.string(forKey:) ?? "") ?? .buddy`, `as? Bool ?? default`).
export function parsePref<K extends PrefKey>(key: K, raw: unknown): PrefValues[K] {
  const d = PREF_DEFAULTS;
  let v: unknown;
  switch (key) {
    case "skin":
      v = oneOf(SKIN_IDS, raw, d.skin);
      break;
    case "language":
      v = oneOf(LANGUAGES, raw, d.language);
      break;
    case "mischief":
      v = oneOf(MISCHIEFS, raw, d.mischief);
      break;
    case "size":
      v = typeof raw === "number" && Number.isFinite(raw) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, raw)) : d.size;
      break;
    case "soundOn":
    case "quietWhenWatching":
    case "autoUpdate":
      v = typeof raw === "boolean" ? raw : d[key];
      break;
    case "knockStyle":
      v = raw === "inPlace" ? "inPlace" : "center";
      break;
  }
  return v as PrefValues[K];
}

/// How often the walking pet's x is written at most (Swift writes UserDefaults on every step; a store write is an IPC).
export const PET_X_SAVE_INTERVAL_MS = 1000;

export class Preferences {
  private values: PrefValues;
  private _petX: number | null;
  private readonly listeners = new Set<(key: PrefKey) => void>();
  private petXTimer: ReturnType<typeof setTimeout> | null = null;
  private petXDirty = false;
  private l10nCache: { language: Language; l10n: L10n } | null = null;

  constructor(
    private readonly store: KeyValueStore,
    stored: Record<string, unknown> = {},
  ) {
    this.values = {
      skin: parsePref("skin", stored.skin),
      language: parsePref("language", stored.language),
      mischief: parsePref("mischief", stored.mischief),
      soundOn: parsePref("soundOn", stored.soundOn),
      size: parsePref("size", stored.size),
      quietWhenWatching: parsePref("quietWhenWatching", stored.quietWhenWatching),
      autoUpdate: parsePref("autoUpdate", stored.autoUpdate),
      knockStyle: parsePref("knockStyle", stored.knockStyle),
    };
    this._petX = typeof stored.petX === "number" && Number.isFinite(stored.petX) ? stored.petX : null;
  }

  /// Opens `prefs.json` through tauri-plugin-store and follows changes made by other windows.
  static async load(store?: KeyValueStore): Promise<Preferences> {
    const s = store ?? (await openPluginStore());
    const stored: Record<string, unknown> = {};
    for (const key of [...PREF_KEYS, "petX"]) stored[key] = await s.get(key);
    const prefs = new Preferences(s, stored);
    if (s.onChange !== undefined) {
      await s.onChange((key, value) => prefs.externalChange(key, value));
    }
    return prefs;
  }

  get skin(): SkinID {
    return this.values.skin;
  }
  set skin(v: SkinID) {
    this.set("skin", v);
  }
  get language(): Language {
    return this.values.language;
  }
  set language(v: Language) {
    this.set("language", v);
  }
  get mischief(): Mischief {
    return this.values.mischief;
  }
  set mischief(v: Mischief) {
    this.set("mischief", v);
  }
  get soundOn(): boolean {
    return this.values.soundOn;
  }
  set soundOn(v: boolean) {
    this.set("soundOn", v);
  }
  get size(): number {
    return this.values.size;
  }
  set size(v: number) {
    this.set("size", v);
  }
  get quietWhenWatching(): boolean {
    return this.values.quietWhenWatching;
  }
  set quietWhenWatching(v: boolean) {
    this.set("quietWhenWatching", v);
  }
  get autoUpdate(): boolean {
    return this.values.autoUpdate;
  }
  set autoUpdate(v: boolean) {
    this.set("autoUpdate", v);
  }
  get knockStyle(): KnockStyle {
    return this.values.knockStyle;
  }
  set knockStyle(v: KnockStyle) {
    this.set("knockStyle", v);
  }

  get l10n(): L10n {
    if (this.l10nCache === null || this.l10nCache.language !== this.language) {
      this.l10nCache = { language: this.language, l10n: new L10n(this.language) };
    }
    return this.l10nCache.l10n;
  }

  /// Last horizontal center of the pet on the floor, global PHYSICAL px; null = never saved (default: right side).
  get petX(): number | null {
    return this._petX;
  }
  /// Remembered in memory at once, written to the store at most once per `PET_X_SAVE_INTERVAL_MS`. Does not notify.
  set petX(v: number | null) {
    this._petX = v;
    this.petXDirty = true;
    if (this.petXTimer === null) {
      this.petXTimer = setTimeout(() => {
        this.petXTimer = null;
        void this.flushPetX();
      }, PET_X_SAVE_INTERVAL_MS);
    }
  }

  /// Writes a pending `petX` now (drag end, quit).
  async flushPetX(): Promise<void> {
    if (this.petXTimer !== null) {
      clearTimeout(this.petXTimer);
      this.petXTimer = null;
    }
    if (!this.petXDirty) return;
    this.petXDirty = false;
    try {
      await this.store.set("petX", this._petX);
    } catch {
      // a failed write just means the next walk step tries again
    }
  }

  /// Any published setting changed (Swift `objectWillChange`); returns the unsubscribe function.
  onChange(cb: (key: PrefKey) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set<K extends PrefKey>(key: K, raw: PrefValues[K]): void {
    const v = parsePref(key, raw);
    if (this.values[key] === v) return;
    this.values[key] = v;
    void this.store.set(key, v).catch(() => {});
    this.notify(key);
  }

  /// Another window wrote the store (the Settings window in P5).
  private externalChange(key: string, raw: unknown): void {
    if ((PREF_KEYS as string[]).includes(key)) {
      const k = key as PrefKey;
      const v = parsePref(k, raw);
      if (this.values[k] === v) return; // our own write echoing back
      (this.values as unknown as Record<string, unknown>)[k] = v;
      this.notify(k);
    }
  }

  private notify(key: PrefKey): void {
    for (const cb of [...this.listeners]) cb(key);
  }
}

/// `prefs.json` through tauri-plugin-store (loaded lazily so tests never import the Tauri API).
async function openPluginStore(): Promise<KeyValueStore> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("prefs.json", { defaults: {}, autoSave: 100 });
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    onChange: (cb) => store.onChange<unknown>((key, value) => cb(key, value)),
  };
}
