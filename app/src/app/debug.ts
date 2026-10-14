// `BUDDY_DEBUG=1` (read in Rust, src-tauri/src/dev.rs): log frame-rate changes and pet events, like Swift's BUDDY_DEBUG.

import { invoke } from "@tauri-apps/api/core";

export interface DebugConfig {
  debug: boolean;
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