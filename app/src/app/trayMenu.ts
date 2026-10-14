// port of Sources/ClaudeBuddy/StatusMenu.swift (Mac reference v0.0.9): the tray face + menu, rebuilt whenever prefs,
// the waiting list or the update state change. Windows tray menus can't be mirrored to RTL through Tauri (Q8):
// same order, localized labels.

import { invoke } from "@tauri-apps/api/core";
import type { Waiting } from "../core/attention";
import { drawMenuBarFace } from "../render/appIcon";
import type { Preferences } from "./prefs";

interface TrayItem {
  kind: "item" | "check" | "separator";
  id?: string;
  label?: string;
  enabled?: boolean;
  checked?: boolean;
}

/// Tray face at 32 px (Windows scales it to the tray size), badge dot when someone is waiting.
function facePng(prefs: Preferences, badge: boolean): string {
  const size = 32;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  drawMenuBarFace(c.getContext("2d")!, prefs.skin, badge, size);
  return c.toDataURL("image/png").split(",")[1];
}

export function rebuildTray(prefs: Preferences, waiting: readonly Waiting[], updateVersion: string | null): void {
  const l = prefs.l10n;
  const items: TrayItem[] = [];
  if (waiting.length > 0) {
    items.push({ kind: "item", id: "waiting", label: l.t("menuWaiting"), enabled: false });
    for (const w of waiting) {
      const b = l.bubble([w]);
      items.push({ kind: "item", id: "w", label: `${b.title}  ${w.project}`, enabled: false });
    }
    items.push({ kind: "separator" });
  }
  if (updateVersion !== null) {
    items.push({ kind: "item", id: "installUpdate", label: l.format("menuInstallUpdate", { v: updateVersion }) });
    items.push({ kind: "separator" });
  }
  items.push({ kind: "item", id: "settings", label: l.t("menuSettings") });
  items.push({ kind: "item", id: "checkUpdates", label: l.t("menuCheckUpdates") });
  items.push({ kind: "separator" });
  items.push({ kind: "item", id: "testKnock", label: l.t("menuTestKnock") });
  items.push({ kind: "item", id: "sendHome", label: l.t("menuSendHome") });
  items.push({ kind: "check", id: "mute", label: l.t("menuMute"), checked: !prefs.soundOn });
  items.push({ kind: "separator" });
  items.push({ kind: "item", id: "quit", label: l.t("menuQuit") });
  void invoke("set_tray", { items, png: facePng(prefs, waiting.length > 0) });
}
