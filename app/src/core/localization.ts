// port of Sources/BuddyCore/Localization.swift (Mac reference v0.0.9)
// The key list and string table below are generated from the Swift source (strings copied verbatim, ZWNJ intact).

import type { SkinID } from "./pose";
import type { Waiting } from "./attention";

/// Swift `Language.allCases` (same order).
export const LANGUAGES = ["system", "en", "fa"] as const;
export type Language = (typeof LANGUAGES)[number];

/// Swift `L10nKey.allCases` (same order).
export const L10N_KEYS = [
  "finishedTitle",
  "finishedDetail",
  "permissionTitle",
  "permissionDetail",
  "attentionTitle",
  "manyTitle",
  "knockWord",
  "menuSettings",
  "menuTestKnock",
  "menuSendHome",
  "menuMute",
  "menuQuit",
  "settingsTitle",
  "sectionCharacter",
  "sectionBehavior",
  "sectionLanguage",
  "sectionAgents",
  "skinBuddy",
  "skinKitty",
  "skinPuppy",
  "skinRobo",
  "skinBunny",
  "skinNinja",
  "skinCyberNinja",
  "skinByte",
  "mischief",
  "mischiefCalm",
  "mischiefPlayful",
  "mischiefNaughty",
  "mischiefHint",
  "size",
  "sound",
  "testKnock",
  "launchAtLogin",
  "languageSystem",
  "quietWhenWatching",
  "quietHint",
  "menuWaiting",
  "connected",
  "notConnected",
  "connect",
  "disconnect",
  "toolNotFound",
  "codexTrustHint",
  "otherAgentsHint",
  "sectionUpdates",
  "menuCheckUpdates",
  "menuInstallUpdate",
  "updatesAuto",
  "updateVersion",
  "updateUpToDate",
  "updateAvailable",
  "updateChecking",
  "updateInstalling",
  "updateFailed",
  "checkNow",
  "installNow",
  // Windows additions (Pooria, 2026-10-15)
  "knockStyle",
  "knockStyleCenter",
  "knockStyleInPlace",
  "impatient",
] as const;
export type L10nKey = (typeof L10N_KEYS)[number];

export interface L10nPair {
  en: string;
  fa: string;
}

// port of Pose.swift SkinID.nameKey
export function skinNameKey(id: SkinID): L10nKey {
  switch (id) {
    case "buddy":
      return "skinBuddy";
    case "kitty":
      return "skinKitty";
    case "puppy":
      return "skinPuppy";
    case "bunny":
      return "skinBunny";
    case "robo":
      return "skinRobo";
    case "ninja":
      return "skinNinja";
    case "cyberNinja":
      return "skinCyberNinja";
    case "byte":
      return "skinByte";
  }
}

/// `navigator.languages` when available (the app passes it explicitly).
function systemPreferredLanguages(): readonly string[] {
  return typeof navigator !== "undefined" && navigator.languages ? navigator.languages : [];
}

/// Strings in English and Persian. `{agent}`, `{n}` and `{v}` are placeholders.
/// Windows wording for the three strings that name the Mac or `notify.sh` (12-windows-plan.md P5; Pooria to approve).
/// Applied on Windows only; the Mac keeps the original wording (see MAC_OVERRIDES).
export const WINDOWS_OVERRIDES: Partial<Record<L10nKey, L10nPair>> = {
  launchAtLogin: { en: "Open at login", fa: "با روشن شدن ویندوز باز شه" },
  toolNotFound: { en: "not found on this PC", fa: "روی این کامپیوتر پیدا نشد" },
  otherAgentsHint: {
    en: "Any other tool can call:  ~/.claude-buddy/buddy-notify.exe <name> done",
    fa: "هر ابزار دیگه‌ای هم می‌تونه صدا بزنه:  ~/.claude-buddy/buddy-notify.exe <name> done",
  },
};

/// Mac: the original wording, except the hint that names `notify.sh` - this app installs `buddy-notify` instead.
export const MAC_OVERRIDES: Partial<Record<L10nKey, L10nPair>> = {
  otherAgentsHint: {
    en: "Any other tool can call:  ~/.claude-buddy/buddy-notify <name> done",
    fa: "هر ابزار دیگه‌ای هم می‌تونه صدا بزنه:  ~/.claude-buddy/buddy-notify <name> done",
  },
};

/// Linux: the Mac wording with "computer" for "Mac".
export const LINUX_OVERRIDES: Partial<Record<L10nKey, L10nPair>> = {
  launchAtLogin: { en: "Open at login", fa: "با روشن شدن سیستم باز شه" },
  toolNotFound: { en: "not found on this computer", fa: "روی این کامپیوتر پیدا نشد" },
  otherAgentsHint: MAC_OVERRIDES.otherAgentsHint,
};

export type Platform = "mac" | "windows" | "linux";

function detectPlatform(): Platform {
  const ua = typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : "";
  if (/Mac/.test(ua)) return "mac";
  if (/Linux|X11/.test(ua)) return "linux";
  return "windows";
}

export class L10n {
  /// Which wording overrides apply; settable for tests.
  static platform: Platform = detectPlatform();

  /// Always "en" or "fa".
  readonly language: "en" | "fa";

  /// `system` -> `fa` if the first preferred language starts with `fa` (Windows adaptation 5).
  constructor(preference: Language, preferred: readonly string[] = systemPreferredLanguages()) {
    if (preference === "en" || preference === "fa") {
      this.language = preference;
    } else {
      this.language = (preferred[0] ?? "en").startsWith("fa") ? "fa" : "en";
    }
  }

  get isRTL(): boolean {
    return this.language === "fa";
  }

  /// Swift `callAsFunction(_ key:)`.
  t(key: L10nKey): string {
    const overrides =
      L10n.platform === "mac" ? MAC_OVERRIDES : L10n.platform === "linux" ? LINUX_OVERRIDES : WINDOWS_OVERRIDES;
    const pair = overrides[key] ?? (L10n.table as Partial<Record<L10nKey, L10nPair>>)[key] ?? { en: key, fa: key };
    return this.language === "fa" ? pair.fa : pair.en;
  }

  format(key: L10nKey, args: { agent?: string; n?: number; v?: string } = {}): string {
    const { agent = "", n = 0, v = "" } = args;
    return this.t(key)
      .split("{agent}")
      .join(agent)
      .split("{n}")
      .join(this.number(n))
      .split("{v}")
      .join(v);
  }

  number(n: number): string {
    if (this.language !== "fa") return String(n);
    return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
  }

  /// The quiet tag above the buddy's head, e.g. "✓ my-app" or "✓ api +2".
  hint(entries: readonly Waiting[]): string | null {
    const first = entries[0];
    if (first === undefined) return null;
    let text = "✓ " + (first.project === "" ? first.agent : first.project);
    if (entries.length > 1) text += " +" + this.number(entries.length - 1);
    return text;
  }

  /// Speech bubble text for whoever is waiting.
  bubble(entries: readonly Waiting[]): { title: string; subtitle: string } {
    if (entries.length > 1) {
      return {
        title: this.format("manyTitle", { n: entries.length }),
        subtitle: entries.map((w) => (w.project === "" ? w.agent : w.project)).join(" · "),
      };
    }
    const w = entries[0];
    if (w === undefined) return { title: "", subtitle: "" };
    let title: string;
    let detail: string;
    switch (w.kind.type) {
      case "needsPermission":
        title = this.format("permissionTitle", { agent: w.agent });
        detail = this.t("permissionDetail");
        break;
      case "needsAttention":
        title = this.format("attentionTitle", { agent: w.agent });
        detail = w.kind.message === "" ? this.t("finishedDetail") : w.kind.message;
        break;
      default:
        title = this.format("finishedTitle", { agent: w.agent });
        detail = this.t("finishedDetail");
        break;
    }
    if (w.project !== "") detail += ` · ${w.project}`;
    return { title, subtitle: detail };
  }

  static readonly table: Readonly<Record<L10nKey, L10nPair>> = {
    finishedTitle: { en: "{agent} is done! ✨", fa: "کار {agent} تموم شد! ✨" },
    finishedDetail: { en: "waiting for you 👀", fa: "منتظرته 👀" },
    permissionTitle: { en: "{agent} needs your OK! 🙋", fa: "{agent} اجازه می‌خواد! 🙋" },
    permissionDetail: { en: "come take a look", fa: "یه سر بزن" },
    attentionTitle: { en: "{agent} needs you! 👋", fa: "{agent} کارت داره! 👋" },
    manyTitle: { en: "{n} agents are waiting! 👀", fa: "{n} تا ایجنت منتظرتن! 👀" },
    knockWord: { en: "Knock!", fa: "تق!" },
    menuSettings: { en: "Settings…", fa: "تنظیمات…" },
    menuTestKnock: { en: "Knock (test)", fa: "در بزن (تست)" },
    menuSendHome: { en: "Back to your spot", fa: "برگرد سر جات" },
    menuMute: { en: "Mute", fa: "بی‌صدا" },
    menuQuit: { en: "Quit", fa: "خروج" },
    settingsTitle: { en: "Buddy Settings", fa: "تنظیمات رفیق" },
    sectionCharacter: { en: "Character", fa: "شخصیت" },
    sectionBehavior: { en: "Behavior", fa: "رفتار" },
    sectionLanguage: { en: "Language", fa: "زبان" },
    sectionAgents: { en: "Agents", fa: "ایجنت‌ها" },
    skinBuddy: { en: "Buddy", fa: "آدمک" },
    skinKitty: { en: "Kitty", fa: "گربه" },
    skinPuppy: { en: "Puppy", fa: "توله‌سگ" },
    skinRobo: { en: "Robo", fa: "ربات" },
    skinBunny: { en: "Bunny", fa: "خرگوش" },
    skinNinja: { en: "Ninja", fa: "نینجا" },
    skinCyberNinja: { en: "Cyber Ninja", fa: "نینجای سایبری" },
    skinByte: { en: "Byte", fa: "بایت" },
    mischief: { en: "Mischief", fa: "شیطونی" },
    mischiefCalm: { en: "Calm", fa: "آروم" },
    mischiefPlayful: { en: "Playful", fa: "بازیگوش" },
    mischiefNaughty: { en: "Naughty", fa: "شیطون" },
    mischiefHint: { en: "Playful and Naughty buddies walk around, dance and chase your cursor. Drag them around — they fall back to the floor.", fa: "بازیگوش و شیطون راه می‌رن، می‌رقصن و دنبال موس می‌کنن. می‌تونی بلندش کنی و ولش کنی — می‌افته پایین." },
    size: { en: "Size", fa: "اندازه" },
    sound: { en: "Knock sound", fa: "صدای در زدن" },
    testKnock: { en: "Try a knock", fa: "امتحان کن" },
    launchAtLogin: { en: "Open at login", fa: "با روشن شدن مک باز شه" },
    languageSystem: { en: "System", fa: "زبان سیستم" },
    quietWhenWatching: { en: "Don't knock if I'm already in the Claude / Codex app", fa: "اگه تو خود اپ Claude یا Codex هستم در نزن" },
    quietHint: { en: "Only for the agent's own app (sessions in Terminal or an editor always get a knock). It shows a small hint above the buddy instead; if you walk away, it knocks when the agent reminds you.", fa: "فقط برای خود اپ ایجنت (سشن‌های داخل ترمینال یا ادیتور همیشه در می‌زنن). به جاش یه نشونه‌ی کوچیک بالای سر رفیق میاد؛ اگه از پشت سیستم بلند شی، با یادآوری ایجنت میاد در می‌زنه." },
    menuWaiting: { en: "Waiting for you", fa: "منتظرتن" },
    connected: { en: "Connected", fa: "وصله" },
    notConnected: { en: "Not connected", fa: "وصل نیست" },
    connect: { en: "Connect", fa: "وصل کن" },
    disconnect: { en: "Disconnect", fa: "قطع کن" },
    toolNotFound: { en: "not found on this Mac", fa: "روی این مک پیدا نشد" },
    codexTrustHint: { en: "After connecting, run /hooks in Codex once and trust the buddy hooks.", fa: "بعد از وصل کردن، یه بار تو Codex دستور /hooks رو بزن و هوک‌های رفیق رو تأیید کن." },
    otherAgentsHint: { en: "Any other tool can call:  ~/.claude-buddy/notify.sh <name> done", fa: "هر ابزار دیگه‌ای هم می‌تونه صدا بزنه:  ~/.claude-buddy/notify.sh <name> done" },
    sectionUpdates: { en: "Updates", fa: "به‌روزرسانی" },
    menuCheckUpdates: { en: "Check for Updates…", fa: "بررسی به‌روزرسانی…" },
    menuInstallUpdate: { en: "⬆︎ Update to {v}", fa: "⬆︎ به‌روزرسانی به {v}" },
    updatesAuto: { en: "Install updates automatically", fa: "به‌روزرسانی‌ها خودکار نصب بشن" },
    updateVersion: { en: "Version {v}", fa: "نسخه‌ی {v}" },
    updateUpToDate: { en: "Up to date ({v})", fa: "آخرین نسخه رو داری ({v})" },
    updateAvailable: { en: "Version {v} is available", fa: "نسخه‌ی {v} اومده" },
    updateChecking: { en: "Checking…", fa: "در حال بررسی…" },
    updateInstalling: { en: "Downloading and installing…", fa: "در حال دانلود و نصب…" },
    updateFailed: { en: "Update failed: {v}", fa: "به‌روزرسانی نشد: {v}" },
    checkNow: { en: "Check now", fa: "الان چک کن" },
    installNow: { en: "Install & restart", fa: "نصب و اجرای دوباره" },
    knockStyle: { en: "Knock", fa: "در زدن" },
    knockStyleCenter: { en: "Big, in the middle", fa: "بزرگ، وسط صفحه" },
    knockStyleInPlace: { en: "Right where it is", fa: "همون‌جا که هست" },
    // Windows addition (Pooria, 2026-10-21)
    impatient: { en: "Get impatient if I don't answer", fa: "اگه جواب ندادم، بی‌تاب شه" },
  };
}
