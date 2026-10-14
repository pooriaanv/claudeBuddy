//! "Is the human looking at this app right now?" for quiet mode (12-windows-plan.md D9).
//! Port of `Focus.isWatching` / `Focus.onScreenWindows` (Sources/ClaudeBuddy/Focus.swift) and
//! `ScreenWindows.frontmostOwner` (Sources/BuddyCore/Agents.swift).
//!
//! Only the facts are computed here; the TypeScript side combines them:
//! `watching = quietWhenWatching && isDedicated(host) && sameExe && !minimized && topOwnerIsForeground && idleSecs < 15`.
// Registered as a Tauri command by the P4 integration step.
#![allow(dead_code)]

use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetForegroundWindow, GetLayeredWindowAttributes, GetWindowLongPtrW, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, LWA_ALPHA, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};
use windows::core::{BOOL, PWSTR};

/// Smaller windows are helpers, not the app's window (Swift: `width >= 80 && height >= 80`).
const MIN_WINDOW_SIZE: i32 = 80;
/// Window alpha at or below this counts as invisible (Swift: `alpha > 0.05`).
const MIN_ALPHA: f32 = 0.05;

/// The answer for the TypeScript side (camelCase, as in the IPC table of the plan).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundCheck {
    /// The foreground window belongs to the process running `host`.
    pub same_exe: bool,
    /// The foreground window is minimized (or not visible at all).
    pub minimized: bool,
    /// The topmost normal window on screen belongs to the foreground window's process.
    pub top_owner_is_foreground: bool,
    /// Seconds since the last mouse/keyboard input.
    pub idle_secs: f64,
}

/// What the filter needs to know about one top-level window (Swift `WindowInfo`, plus the Windows flags).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub visible: bool,
    pub iconic: bool,
    /// DWM-cloaked: on another virtual desktop, or a suspended UWP app.
    pub cloaked: bool,
    pub ex_style: u32,
    /// Layered-window alpha, 0.0 to 1.0; 1.0 for everything that is not alpha-layered.
    pub alpha: f32,
    pub width: i32,
    pub height: i32,
}

impl Default for WindowInfo {
    /// An ordinary visible 1200x800 window; tests change what they care about.
    fn default() -> Self {
        WindowInfo {
            hwnd: 0,
            pid: 0,
            visible: true,
            iconic: false,
            cloaked: false,
            ex_style: 0,
            alpha: 1.0,
            width: 1200,
            height: 800,
        }
    }
}

/// Port of `ScreenWindows.frontmostOwner`: the owner of the topmost normal window actually on screen
/// (`windows` is ordered top to bottom). Skips invisible, minimized and cloaked windows, our own pet window,
/// tool windows, always-on-top windows (Mac: layer != 0, i.e. overlays), near-transparent and tiny windows.
pub fn frontmost_owner(windows: &[WindowInfo], pet_hwnd: isize) -> Option<u32> {
    windows.iter().find(|w| is_normal_window(w, pet_hwnd)).map(|w| w.pid)
}

fn is_normal_window(w: &WindowInfo, pet_hwnd: isize) -> bool {
    w.visible
        && !w.iconic
        && !w.cloaked
        && w.hwnd != pet_hwnd
        && w.ex_style & WS_EX_TOOLWINDOW.0 == 0
        && w.ex_style & WS_EX_TOPMOST.0 == 0
        && w.alpha > MIN_ALPHA
        && w.width >= MIN_WINDOW_SIZE
        && w.height >= MIN_WINDOW_SIZE
}

/// Port of `Focus.isWatching`'s fact gathering (the "is dedicated app" rule lives in `core/agents.ts`).
/// `host` is the `@host` path of the event; `pet_hwnd` is our own window's handle (`window.hwnd()?.0 as isize`).
pub fn foreground_check(host: &str, pet_hwnd: isize) -> ForegroundCheck {
    let idle_secs = idle_seconds();
    // SAFETY: no preconditions; returns null when there is no foreground window.
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return ForegroundCheck { same_exe: false, minimized: false, top_owner_is_foreground: false, idle_secs };
    }
    let pid = window_pid(foreground);
    let same_exe = !host.is_empty() && image_path(pid).is_some_and(|path| same_path(&path, host));
    // SAFETY: `foreground` is a window handle just returned by the system; a stale one only makes these return false.
    let minimized = unsafe { IsIconic(foreground).as_bool() || !IsWindowVisible(foreground).as_bool() };
    let top_owner_is_foreground = frontmost_owner(&on_screen_windows(), pet_hwnd) == Some(pid);
    ForegroundCheck { same_exe, minimized, top_owner_is_foreground, idle_secs }
}

/// Port of `Focus.userIdleSeconds`: seconds since the last mouse/keyboard input.
pub fn idle_seconds() -> f64 {
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` is a live LASTINPUTINFO with cbSize set.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return 0.0;
    }
    // dwTime is a 32-bit tick count; wrapping subtraction survives its 49-day rollover.
    // SAFETY: no preconditions.
    let now = unsafe { GetTickCount64() } as u32;
    f64::from(now.wrapping_sub(info.dwTime)) / 1000.0
}

/// Do two exe paths name the same file? Case-insensitive, `/` = `\`, without a `\\?\` prefix or trailing separator.
pub fn same_path(a: &str, b: &str) -> bool {
    let normalize = |p: &str| {
        let p = p.strip_prefix(r"\\?\").unwrap_or(p).replace('/', "\\");
        p.trim_end_matches('\\').to_lowercase()
    };
    let (a, b) = (normalize(a), normalize(b));
    !a.is_empty() && a == b
}

/// Port of `Focus.onScreenWindows`: all top-level windows, front to back (`EnumWindows` order).
pub fn on_screen_windows() -> Vec<WindowInfo> {
    let mut windows: Vec<WindowInfo> = Vec::new();
    // SAFETY: the callback only runs during this call and casts `lparam` back to the Vec it was given.
    unsafe {
        let _ = EnumWindows(Some(collect_window), LPARAM(&mut windows as *mut Vec<WindowInfo> as isize));
    }
    windows
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` is the `&mut Vec<WindowInfo>` passed by `on_screen_windows`.
    let windows = unsafe { &mut *(lparam.0 as *mut Vec<WindowInfo>) };
    windows.push(window_info(hwnd));
    BOOL(1) // keep enumerating
}

fn window_info(hwnd: HWND) -> WindowInfo {
    let mut info = WindowInfo { hwnd: hwnd.0 as isize, pid: window_pid(hwnd), ..WindowInfo::default() };
    // SAFETY: plain queries on a handle that EnumWindows just gave us; failures leave the defaults.
    unsafe {
        info.visible = IsWindowVisible(hwnd).as_bool();
        if !info.visible {
            return info; // the filter drops it anyway; skip the rest of the syscalls
        }
        info.iconic = IsIconic(hwnd).as_bool();
        info.ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;

        let mut cloaked = 0u32;
        let result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut core::ffi::c_void,
            size_of::<u32>() as u32,
        );
        info.cloaked = result.is_ok() && cloaked != 0;

        // Alpha only exists for SetLayeredWindowAttributes windows; color-key / per-pixel-alpha windows fail or
        // lack LWA_ALPHA and count as opaque.
        if info.ex_style & WS_EX_LAYERED.0 != 0 {
            let (mut key, mut alpha, mut flags) = (Default::default(), 0u8, Default::default());
            if GetLayeredWindowAttributes(hwnd, Some(&mut key), Some(&mut alpha), Some(&mut flags)).is_ok()
                && flags & LWA_ALPHA == LWA_ALPHA
            {
                info.alpha = f32::from(alpha) / 255.0;
            }
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            info.width = rect.right - rect.left;
            info.height = rect.bottom - rect.top;
        }
    }
    info
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: `pid` is a live u32.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// Full image path of `pid` (`QueryFullProcessImageNameW`); `None` for protected or exited processes.
fn image_path(pid: u32) -> Option<String> {
    // SAFETY: the handle is closed below; the buffer holds `len` UTF-16 units.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = vec![0u16; 32_768]; // the longest path Windows allows
        let mut len = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        result.ok()?;
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PET: isize = 0xBEEF;

    fn win(pid: u32) -> WindowInfo {
        WindowInfo { pid, hwnd: i64::from(pid) as isize + 100, ..WindowInfo::default() }
    }

    /// Port of `frontmostWindowOwnerSkipsOverlaysAndTinyWindows`.
    #[test]
    fn frontmost_window_owner_skips_overlays_and_tiny_windows() {
        let windows = [
            WindowInfo { ex_style: WS_EX_TOPMOST.0, width: 400, height: 400, ..win(1) }, // always-on-top overlay
            WindowInfo { alpha: 0.0, width: 800, height: 600, ..win(2) },                 // invisible (alpha 0)
            WindowInfo { width: 20, height: 20, ..win(3) },                               // tiny helper window
            win(4),                                                                       // the real front window
            win(5),
        ];
        assert_eq!(frontmost_owner(&windows, PET), Some(4));
        assert_eq!(frontmost_owner(&[], PET), None); // e.g. the only app is minimized
    }

    #[test]
    fn windows_specific_skips() {
        let skipped = [
            WindowInfo { visible: false, ..win(1) },
            WindowInfo { iconic: true, ..win(1) },
            WindowInfo { cloaked: true, ..win(1) }, // other virtual desktop
            WindowInfo { hwnd: PET, ..win(1) },     // our own pet
            WindowInfo { ex_style: WS_EX_TOOLWINDOW.0, ..win(1) },
            WindowInfo { ex_style: WS_EX_TOPMOST.0 | WS_EX_LAYERED.0, ..win(1) },
            WindowInfo { alpha: MIN_ALPHA, ..win(1) }, // "<= 0.05" is invisible
            WindowInfo { width: 79, ..win(1) },
            WindowInfo { height: 79, ..win(1) },
        ];
        for (i, w) in skipped.iter().enumerate() {
            assert_eq!(frontmost_owner(&[*w, win(2)], PET), Some(2), "case {i}: {w:?}");
        }
    }

    #[test]
    fn border_values_still_count() {
        let w = WindowInfo { width: 80, height: 80, alpha: 0.06, ex_style: WS_EX_LAYERED.0, ..win(7) };
        assert_eq!(frontmost_owner(&[w], PET), Some(7));
    }

    #[test]
    fn first_qualifying_window_wins_in_z_order() {
        let windows = [win(10), win(11), win(10)];
        assert_eq!(frontmost_owner(&windows, PET), Some(10));
        assert_eq!(frontmost_owner(&windows[1..], PET), Some(11));
    }

    #[test]
    fn exe_paths_compare_case_insensitively_across_separators() {
        let a = r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64__abc\app\Claude.exe";
        assert!(same_path(a, a));
        assert!(same_path(a, "c:/program files/windowsapps/claude_1.0.0.0_x64__abc/app/claude.exe"));
        assert!(same_path(a, &format!(r"\\?\{a}")));
        assert!(!same_path(a, r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64__abc\app\claude-helper.exe"));
        assert!(!same_path(a, r"C:\Users\me\AppData\Roaming\Claude\claude-code\2.1.295\h\claude.exe"));
        assert!(!same_path("", ""));
        assert!(!same_path(a, ""));
    }

    #[test]
    fn serializes_in_camel_case() {
        let check = ForegroundCheck { same_exe: true, minimized: false, top_owner_is_foreground: true, idle_secs: 2.5 };
        assert_eq!(
            serde_json::to_string(&check).unwrap(),
            r#"{"sameExe":true,"minimized":false,"topOwnerIsForeground":true,"idleSecs":2.5}"#
        );
    }

    /// The Win32 side runs for real (nothing is asserted about this machine's windows).
    #[test]
    fn live_enumeration_and_check_do_not_crash() {
        let windows = on_screen_windows();
        assert!(!windows.is_empty(), "there is always at least one top-level window (e.g. Program Manager)");
        assert!(idle_seconds() >= 0.0);
        let check = foreground_check(r"C:\definitely\not\the\foreground\app.exe", 0);
        assert!(!check.same_exe);
        assert!(check.idle_secs >= 0.0);
        assert!(!foreground_check("", 0).same_exe);
    }
}
