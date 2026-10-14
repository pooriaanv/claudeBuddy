// Windows replacement for Sources/ClaudeBuddy/Updater.swift (+ the update parts of Coordinator.swift): checks the
// GitHub release's latest.json through tauri-plugin-updater, installs the signed NSIS update and relaunches.
// Same UX as the Mac: 10 s after launch and then about once a day (> 20 h), "Check for Updates…" in the tray and
// the Updates tab, auto-install only when allowed, nothing is waiting and the buddy is just hanging out.

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { load } from "@tauri-apps/plugin-store";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string }
  | { kind: "installing" }
  | { kind: "failed"; message: string };

export class Updater {
  state: UpdateState = { kind: "idle" };
  current = "";
  onChange: (() => void) | null = null;
  private update: Update | null = null;

  async init(): Promise<void> {
    this.current = await getVersion();
  }

  get availableVersion(): string | null {
    return this.state.kind === "available" ? this.state.version : null;
  }

  private set(s: UpdateState): void {
    this.state = s;
    this.onChange?.();
  }

  async check(): Promise<void> {
    if (this.state.kind === "checking" || this.state.kind === "installing") return;
    this.set({ kind: "checking" });
    try {
      const u = await check({ timeout: 20000 });
      const store = await load("prefs.json", { autoSave: true, defaults: {} });
      await store.set("lastUpdateCheck", new Date().toISOString());
      this.update = u;
      this.set(u ? { kind: "available", version: u.version } : { kind: "upToDate" });
    } catch (e) {
      this.set({ kind: "failed", message: String(e) });
    }
  }

  /// At most about once a day on its own (Coordinator.checkForUpdatesIfDue).
  async checkIfDue(): Promise<void> {
    const store = await load("prefs.json", { autoSave: true, defaults: {} });
    const last = await store.get<string>("lastUpdateCheck");
    const age = last ? Date.now() - Date.parse(last) : Infinity;
    if (!(age < 20 * 3600 * 1000)) await this.check();
  }

  async install(): Promise<void> {
    if (this.update === null) return;
    this.set({ kind: "installing" });
    try {
      await this.update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      this.set({ kind: "failed", message: String(e) });
    }
  }
}
