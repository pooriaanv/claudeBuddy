//! Agent events, wired into the app (port of the Rust-side parts of `Coordinator.start`, 12-windows-plan.md D4/D9-D11).
//!
//! - startup: `~/.claude-buddy/inbox`, the hook helper copy, `app-path`, active marker off, stale events dropped,
//!   the "running" mutex the helper checks;
//! - a thread drains the inbox every 0.4 s and emits `inbox {texts}` to the pet page (TS parses);
//! - commands for the active marker, the quiet-mode foreground check and the hook installer.

use crate::hooks::AgentIntegration;
use crate::inbox;
use crate::paths::{BuddyPaths, HELPER_FILE_NAME};
#[cfg(windows)]
use crate::paths::RUNNING_MUTEX_NAME;
#[cfg(windows)]
use crate::platform::foreground::{self, ForegroundCheck};
#[cfg(target_os = "macos")]
use crate::platform::macos::ForegroundCheck;
#[cfg(windows)]
use crate::platform::windows as w;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone)]
struct InboxPayload {
    texts: Vec<String>,
}

/// Where the bundled `buddy-notify.exe` is: the resource dir (installed app), next to the exe, or
/// `BUDDY_NOTIFY_EXE` (dev builds, where the helper is built by its own crate).
fn bundled_helper(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(p) = std::env::var("BUDDY_NOTIFY_EXE") {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join(HELPER_FILE_NAME));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        candidates.push(dir.join(HELPER_FILE_NAME));
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(windows)]
fn hold_running_mutex() {
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::core::HSTRING;
    // Held (leaked) for the whole process lifetime; the helper only checks that it exists.
    unsafe {
        let _ = CreateMutexW(None, true, &HSTRING::from(RUNNING_MUTEX_NAME));
    }
}

/// Port of the first lines of `Coordinator.start` + `BuddyPaths.installNotifyScript`.
pub fn start(app: &tauri::AppHandle) {
    #[cfg(windows)]
    hold_running_mutex();
    let paths = BuddyPaths::current();
    let _ = std::fs::create_dir_all(paths.inbox());
    if let Some(helper) = bundled_helper(app) {
        let _ = paths.install_notify_helper(&helper);
    }
    let _ = paths.write_app_path();
    paths.set_active(false);
    inbox::clean(&paths.inbox(), 15);

    let app = app.clone();
    let _ = std::thread::Builder::new().name("inbox".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let texts = inbox::drain(&paths.inbox());
        if !texts.is_empty() {
            let _ = app.emit_to("pet", "inbox", InboxPayload { texts });
        }
    });
}

#[tauri::command]
pub fn set_active_marker(on: bool) {
    BuddyPaths::current().set_active(on);
}

#[tauri::command]
pub fn foreground_check(host: String) -> ForegroundCheck {
    #[cfg(windows)]
    {
        let pet = w::pet_hwnd().map(|h| h.0 as isize).unwrap_or(0);
        foreground::foreground_check(&host, pet)
    }
    #[cfg(target_os = "macos")]
    crate::platform::macos::foreground_check(&host)
}

fn agent(name: &str) -> Result<AgentIntegration, String> {
    match name {
        "claude" => Ok(AgentIntegration::Claude),
        "codex" => Ok(AgentIntegration::Codex),
        other => Err(format!("unknown agent {other}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    connected: bool,
    tool_detected: bool,
    config_path: String,
}

#[tauri::command]
pub fn hooks_status(agent_name: String) -> Result<HookStatus, String> {
    let a = agent(&agent_name)?;
    let paths = BuddyPaths::current();
    Ok(HookStatus {
        connected: a.is_connected(&paths),
        tool_detected: a.tool_detected(paths.home()),
        config_path: a.config_path(paths.home()).display().to_string(),
    })
}

#[tauri::command]
pub fn hooks_connect(agent_name: String) -> Result<HookStatus, String> {
    agent(&agent_name)?.connect(&BuddyPaths::current()).map_err(|e| e.to_string())?;
    hooks_status(agent_name)
}

#[tauri::command]
pub fn hooks_disconnect(agent_name: String) -> Result<HookStatus, String> {
    agent(&agent_name)?.disconnect(&BuddyPaths::current()).map_err(|e| e.to_string())?;
    hooks_status(agent_name)
}

/// `ClaudeBuddy.exe --connect|--disconnect claude|codex` (port of main.swift). Returns the exit code, or None when the
/// arguments are something else.
pub fn cli(args: &[String]) -> Option<i32> {
    let (op, name) = (args.get(1)?.as_str(), args.get(2)?.as_str());
    if op != "--connect" && op != "--disconnect" {
        return None;
    }
    #[cfg(windows)]
    attach_console();
    let a = match agent(name) {
        Ok(a) => a,
        Err(_) => {
            println!("unknown agent {name}; use: claude, codex");
            return Some(1);
        }
    };
    let paths = BuddyPaths::current();
    let result = if op == "--connect" { a.connect(&paths) } else { a.disconnect(&paths) };
    match result {
        Ok(()) => {
            let state = if a.is_connected(&paths) { "connected" } else { "not connected" };
            println!("{}: {} ({})", a.display_name(), state, a.config_path(paths.home()).display());
            Some(0)
        }
        Err(e) => {
            println!("failed: {e}");
            Some(1)
        }
    }
}

#[cfg(windows)]
fn attach_console() {
    use windows::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}
