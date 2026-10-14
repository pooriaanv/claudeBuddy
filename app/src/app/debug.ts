// DEBUG (P3) -- dev-only hooks, driven by environment variables read in Rust (src-tauri/src/dev.rs):
//   BUDDY_DEBUG=1                      log frame-rate changes and pet events (stderr, like Swift's BUDDY_DEBUG)
//   BUDDY_DEBUG_KNOCK=<delay>,<hold>   test knock with a sample bubble after <delay> s, goHome <hold> s after the knock
//   BUDDY_DEBUG_FRONT=1                handled entirely in Rust (starts at the "front" level)

import { invoke } from "@tauri-apps/api/core";
import { makeWaiting } from "../core/attention";
import type { PetController } from "./pet";
import type { Preferences } from "./prefs";

export interface DebugConfig {
  debug: boolean;
  front: boolean;
  knock: [number, number] | null;
}

export function debugConfig(): Promise<DebugConfig> {
  return invoke<DebugConfig>("debug_config");
}

export function debugLogger(cfg: DebugConfig): ((line: string) => void) | undefined {
  if (!cfg.debug) return undefined;
  return (line) => {
    void invoke("debug_log", { line }).catch(() => {});
  };
}

/// `BUDDY_DEBUG_KNOCK`: a sample bubble (the real one comes from the Coordinator in P4).
export function scheduleTestKnock(cfg: DebugConfig, pet: PetController, prefs: Preferences): void {
  if (cfg.knock === null) return;
  const [delay, hold] = cfg.knock;
  setTimeout(() => {
    const { title, subtitle } = prefs.l10n.bubble([makeWaiting("Claude", "my-app", { type: "finished" })]);
    pet.knock(title, subtitle);
    setTimeout(() => pet.goHome(), hold * 1000);
  }, delay * 1000);
}
