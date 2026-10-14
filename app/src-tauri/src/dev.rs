//! `BUDDY_DEBUG=1` (like `BUDDY_DEBUG` in Swift's `PetController`): log frame-rate changes and pet events to stderr;
//! `BUDDY_DEBUG_LOG=<file>` also appends the lines to that file. Nothing happens when they are unset.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;

fn env_flag(name: &str) -> bool {
    matches!(std::env::var(name), Ok(v) if !v.is_empty() && v != "0")
}

pub fn debug_enabled() -> bool {
    env_flag("BUDDY_DEBUG")
}

/// stderr (+ optional file) line, only when `BUDDY_DEBUG` is set.
pub fn log(line: &str) {
    if !debug_enabled() {
        return;
    }
    eprintln!("[buddy] {line}");
    if let Some(path) = std::env::var_os("BUDDY_DEBUG_LOG").filter(|p| !p.is_empty()) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugConfig {
    debug: bool,
}

#[tauri::command]
pub fn debug_config() -> DebugConfig {
    DebugConfig { debug: debug_enabled() }
}

#[tauri::command]
pub fn debug_log(line: String) {
    log(&line);
}