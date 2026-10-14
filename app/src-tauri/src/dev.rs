//! DEBUG (P3) -- dev-only hooks, driven by environment variables (nothing happens when they are unset).
//! Remove or gate behind `debug_assertions` before the first release (P6).
//!
//! - `BUDDY_DEBUG=1`                 log frame-rate changes and pet events to stderr (like `BUDDY_DEBUG` in Swift's
//!                                   `PetController`); `BUDDY_DEBUG_LOG=<file>` also appends the lines to that file.
//! - `BUDDY_DEBUG_KNOCK=<delay>,<hold>`  test knock with a sample bubble `<delay>` seconds after start,
//!                                   `goHome` `<hold>` seconds after the knock.
//! - `BUDDY_DEBUG_FRONT=1`           start at the "front" level (above other windows) -- for screenshots over a backdrop.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;

fn env_flag(name: &str) -> bool {
    matches!(std::env::var(name), Ok(v) if !v.is_empty() && v != "0")
}

pub fn debug_enabled() -> bool {
    env_flag("BUDDY_DEBUG")
}

pub fn front_requested() -> bool {
    env_flag("BUDDY_DEBUG_FRONT")
}

/// `"2,6"` -> `(2.0, 6.0)`: both numbers finite and >= 0.
pub fn parse_knock_spec(s: &str) -> Option<(f64, f64)> {
    let (a, b) = s.split_once(',')?;
    let delay: f64 = a.trim().parse().ok()?;
    let hold: f64 = b.trim().parse().ok()?;
    (delay.is_finite() && hold.is_finite() && delay >= 0.0 && hold >= 0.0).then_some((delay, hold))
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
    front: bool,
    /// `[delaySecs, holdSecs]`
    knock: Option<[f64; 2]>,
}

#[tauri::command]
pub fn debug_config() -> DebugConfig {
    DebugConfig {
        debug: debug_enabled(),
        front: front_requested(),
        knock: std::env::var("BUDDY_DEBUG_KNOCK").ok().and_then(|s| parse_knock_spec(&s)).map(|(d, h)| [d, h]),
    }
}

#[tauri::command]
pub fn debug_log(line: String) {
    log(&line);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knock_spec_parses_two_non_negative_numbers() {
        assert_eq!(parse_knock_spec("2,6"), Some((2.0, 6.0)));
        assert_eq!(parse_knock_spec(" 0.5 , 10 "), Some((0.5, 10.0)));
        assert_eq!(parse_knock_spec("2"), None);
        assert_eq!(parse_knock_spec("a,b"), None);
        assert_eq!(parse_knock_spec("-1,3"), None);
        assert_eq!(parse_knock_spec("nan,3"), None);
    }
}
