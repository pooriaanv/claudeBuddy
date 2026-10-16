//! Win32 side of the pet window (05-windows.md, 12-windows-plan.md D2, D5-D8).
//!
//! RULE (P0 finding 2): tao rewrites `GWL_EXSTYLE` wholesale and hides windows it thinks are invisible on EVERY
//! window-flag change. After the window is created and shown with raw Win32, never call its `set_ignore_cursor_events`
//! / `set_always_on_*` / `set_visible`; use the functions below instead.

use crate::geometry::Rect;
use serde::Serialize;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::time::Duration;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTOPRIMARY, MONITORINFO, MonitorFromPoint};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetLastInputInfo, LASTINPUTINFO, VK_LBUTTON, VK_RBUTTON,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, LWA_ALPHA, SetLayeredWindowAttributes, GetCursorPos, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect, HWND_BOTTOM, HWND_TOPMOST,
    EVENT_SYSTEM_FOREGROUND, WS_EX_TOPMOST, GetClassNameW, GetForegroundWindow, IsIconic, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    IsWindowVisible, MA_NOACTIVATE, SM_SWAPBUTTON, SW_SHOWNOACTIVATE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, ShowWindow, WINDOWPOS, WM_MOUSEACTIVATE, WM_NCDESTROY,
    WM_WINDOWPOSCHANGING, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

// ---------------------------------------------------------------------------------------------------------------
// The one pet window

static PET_HWND: AtomicIsize = AtomicIsize::new(0);

/// Remembers the pet window so the commands and the hover thread need no `WebviewWindow` handle.
pub fn register_pet(hwnd: HWND) {
    PET_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
}

pub fn pet_hwnd() -> Option<HWND> {
    let v = PET_HWND.load(Ordering::SeqCst);
    (v != 0).then(|| HWND(v as *mut c_void))
}

// ---------------------------------------------------------------------------------------------------------------
// Ex-style, show

pub fn ex_style(hwnd: HWND) -> u32 {
    unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 }
}

/// Makes Windows re-read the frame / ex-style without moving, resizing, re-ordering or activating.
fn frame_changed(hwnd: HWND) {
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

/// Adds `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED` to the existing extended style (all other bits are
/// kept), removes `WS_EX_APPWINDOW` (tao sets it on every top-level window; it would force a taskbar button despite
/// `WS_EX_TOOLWINDOW`) and sets / clears `WS_EX_TRANSPARENT` (click-through). Returns the resulting extended style.
///
/// `WS_EX_LAYERED` is what tao set for the P0 window together with `WS_EX_TRANSPARENT` and what the P0 render
/// was verified with; it stays on for both click-through states.
pub fn apply_pet_ex_style(hwnd: HWND, click_through: bool) -> u32 {
    unsafe {
        let old = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut new = (old | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_LAYERED.0) & !WS_EX_APPWINDOW.0;
        if click_through {
            new |= WS_EX_TRANSPARENT.0;
        } else {
            new &= !WS_EX_TRANSPARENT.0;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new as isize);
        // A layered window without attributes hit-tests against its last layered bitmap, which stays at the size of the
        // first frame: after growing to the knock size, clicks outside the old 150x200 area fell through (P5 bug).
        // Plain alpha 255 makes the whole rect hit-testable; click-through stays WS_EX_TRANSPARENT's job (D6).
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        frame_changed(hwnd);
        new
    }
}

/// D6: toggles `WS_EX_TRANSPARENT` (+ `SWP_FRAMECHANGED`) without touching tao's flag state. A no-op when the bit
/// already has the wanted value.
pub fn set_click_through(hwnd: HWND, enabled: bool) {
    unsafe {
        let old = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let new = if enabled { old | WS_EX_TRANSPARENT.0 } else { old & !WS_EX_TRANSPARENT.0 };
        if new == old {
            return;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new as isize);
        frame_changed(hwnd);
    }
}

/// `ShowWindow(SW_SHOWNOACTIVATE)`: shows the window without activating it. (Tauri's `show()` uses `SW_SHOW` after
/// creation, which activates.) tao's own state says "hidden" afterwards, see the module comment.
pub fn show_no_activate(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Z-order (D8)

/// Where the pet sits in the z-order (port of `PetPanel.level`: `desktopLevel` / `.statusBar`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// Idle: behind every normal window, directly above the desktop (`HWND_BOTTOM`).
    Desktop = 0,
    /// Knocking: above other windows (`HWND_TOPMOST`).
    Front = 1,
    /// Windows addition (Pooria, 2026-10-16): idle, but dropped over an app window - in front of every app
    /// (`HWND_TOPMOST`) until it is dropped on the desktop again.
    Above = 2,
}

/// Set by the last drop: over an app window (true) or the desktop (false). The idle ("desktop") level follows it.
static PINNED: AtomicBool = AtomicBool::new(false);

impl Level {
    pub fn parse(s: &str) -> Option<Level> {
        match s {
            "desktop" if PINNED.load(Ordering::SeqCst) => Some(Level::Above),
            "desktop" => Some(Level::Desktop),
            "front" => Some(Level::Front),
            _ => None,
        }
    }

    fn insert_after(self) -> HWND {
        match self {
            // While the desktop itself is in front (Win+D, a click on the wallpaper) the bottom of the z-order is
            // hidden behind the desktop, so float above it until another window is activated (HWND_BOTTOM then also drops WS_EX_TOPMOST) — the Mac's "desktop icon level + 1".
            Level::Desktop if DESKTOP_IN_FRONT.load(Ordering::SeqCst) => HWND_TOPMOST,
            Level::Desktop => HWND_BOTTOM,
            Level::Front => HWND_TOPMOST,
            Level::Above => HWND_TOPMOST,
        }
    }
}

/// True while the foreground window is the desktop (`Progman` / `WorkerW`).
static DESKTOP_IN_FRONT: AtomicBool = AtomicBool::new(false);

fn is_desktop_window(hwnd: HWND) -> bool {
    let mut buf = [0u16; 32];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) } as usize;
    let class = String::from_utf16_lossy(&buf[..n.min(buf.len())]);
    class == "Progman" || class == "WorkerW"
}

unsafe extern "system" fn foreground_changed(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    let desktop = is_desktop_window(hwnd);
    DESKTOP_IN_FRONT.store(desktop, Ordering::SeqCst);
    let Some(pet) = pet_hwnd() else { return };
    if level() != Level::Desktop {
        return;
    }
    unsafe {
        if desktop && (IsIconic(pet).as_bool() || !IsWindowVisible(pet).as_bool()) {
            let _ = ShowWindow(pet, SW_SHOWNOACTIVATE);
        }
        let _ = SetWindowPos(pet, Some(Level::Desktop.insert_after()), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// The top normal app window under (x, y), skipping the pet; None over the desktop.
fn window_under(x: i32, y: i32, pet: HWND) -> Option<HWND> {
    for info in crate::platform::foreground::on_screen_windows() {
        if info.hwnd == pet.0 as isize || !info.visible || info.iconic || info.cloaked {
            continue;
        }
        if info.ex_style & (WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0 | WS_EX_TRANSPARENT.0) != 0 {
            continue;
        }
        let h = HWND(info.hwnd as *mut c_void);
        let Some(r) = window_rect(h) else { continue };
        if r.w < 80 || r.h < 80 || x < r.x || y < r.y || x >= r.x + r.w as i32 || y >= r.y + r.h as i32 {
            continue;
        }
        return if is_desktop_window(h) { None } else { Some(h) };
    }
    None
}

/// End of a drag (Windows addition): dropped over an app window -> in front of every app (`Level::Above`); over the
/// desktop or the taskbar -> back behind every window (`Level::Desktop`). Knocks return to this level afterwards.
pub fn drop_level(pet: HWND, x: i32, y: i32) {
    let target = window_under(x, y, pet);
    PINNED.store(target.is_some(), Ordering::SeqCst);
    set_level(pet, if target.is_some() { Level::Above } else { Level::Desktop });
    crate::dev::log(&format!("drop at ({x},{y}) over app={} level={:?}", target.is_some(), level()));
}

/// Keeps the idle pet visible when the desktop comes to the front (Win+D / "show desktop"). Must run on a thread
/// with a message loop (the main thread, in `setup`); the hook lives as long as the app.
pub fn install_desktop_watch() {
    unsafe {
        DESKTOP_IN_FRONT.store(is_desktop_window(GetForegroundWindow()), Ordering::SeqCst);
        let _ = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(foreground_changed),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
    }
}

static LEVEL: AtomicU8 = AtomicU8::new(Level::Desktop as u8);

pub fn level() -> Level {
    match LEVEL.load(Ordering::SeqCst) {
        1 => Level::Front,
        2 => Level::Above,
        _ => Level::Desktop,
    }
}

/// Stores the level (the window subclass reads it) and applies it with one `SetWindowPos`
/// (`HWND_BOTTOM` / `HWND_TOPMOST`, no move, no size, no activation). `HWND_BOTTOM` also drops `WS_EX_TOPMOST`.
pub fn set_level(hwnd: HWND, level: Level) {
    LEVEL.store(level as u8, Ordering::SeqCst);
    unsafe {
        let _ = SetWindowPos(hwnd, Some(level.insert_after()), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

const PET_SUBCLASS_ID: usize = 0xB0DD1E;

/// Window subclass of the pet window (D2 / D8):
/// - `WM_WINDOWPOSCHANGING`: whenever something re-orders the window (the raw `ShowWindow`, the shell, ...), force
///   `hwndInsertAfter` to our own level (`HWND_BOTTOM` / `HWND_TOPMOST`);
/// - `WM_MOUSEACTIVATE`: `MA_NOACTIVATE`, so clicking the pet never activates it (no focus steal).
unsafe extern "system" fn pet_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            let pos = lparam.0 as *mut WINDOWPOS;
            if !pos.is_null() {
                // SAFETY: for WM_WINDOWPOSCHANGING lParam points at a WINDOWPOS owned by the system for this call.
                unsafe {
                    if ((*pos).flags.0 & SWP_NOZORDER.0) == 0 {
                        (*pos).hwndInsertAfter = level().insert_after();
                    }
                }
            }
        }
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_NCDESTROY => unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(pet_subclass_proc), PET_SUBCLASS_ID);
        },
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Must run on the thread that owns the window (the main thread, in `setup`).
pub fn install_pet_subclass(hwnd: HWND) -> bool {
    unsafe { SetWindowSubclass(hwnd, Some(pet_subclass_proc), PET_SUBCLASS_ID, 0).as_bool() }
}

// ---------------------------------------------------------------------------------------------------------------
// Frame

/// One `SetWindowPos` (move + resize together) in physical pixels, no re-ordering, no activation.
pub fn set_frame(hwnd: HWND, f: Rect) {
    unsafe {
        let _ = SetWindowPos(hwnd, None, f.x, f.y, f.w, f.h, SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

pub fn window_rect(hwnd: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut r).ok()? };
    Some(Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
}

/// `GetMonitorInfoW(primary monitor).rcWork`: the work area as Win32 reports it (to compare with tao's
/// `Monitor::work_area()`).
pub fn primary_rc_work() -> Option<Rect> {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let r = info.rcWork;
        Some(Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Pointer (D7): replaces `NSEvent.mouseLocation`, "left button down" and `Focus.userIdleSeconds()`

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PointerState {
    /// Global physical px (`GetCursorPos`).
    pub x: i32,
    pub y: i32,
    /// The primary button (the physical right one when the user swapped the buttons, `SM_SWAPBUTTON`).
    pub left_down: bool,
    /// Seconds since the last keyboard / mouse input (`GetLastInputInfo`).
    pub idle_secs: f64,
}

/// The virtual key of the primary button: `GetAsyncKeyState` reports PHYSICAL buttons, so with swapped buttons
/// the primary one is `VK_RBUTTON`.
pub fn primary_button_vk(swapped: bool) -> i32 {
    if swapped { VK_RBUTTON.0 as i32 } else { VK_LBUTTON.0 as i32 }
}

/// `GetTickCount` wraps every 49.7 days; `GetLastInputInfo` uses the same 32-bit clock.
pub fn idle_seconds(tick_now: u32, last_input: u32) -> f64 {
    tick_now.wrapping_sub(last_input) as f64 / 1000.0
}

pub fn pointer_state() -> PointerState {
    unsafe {
        let mut p = POINT::default();
        let _ = GetCursorPos(&mut p);
        let swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
        let left_down = (GetAsyncKeyState(primary_button_vk(swapped)) as u16 & 0x8000) != 0;
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        let idle_secs = if GetLastInputInfo(&mut info).as_bool() { idle_seconds(GetTickCount(), info.dwTime) } else { 0.0 };
        PointerState { x: p.x, y: p.y, left_down, idle_secs }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Hover thread (D6)

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct HoverPayload {
    pub inside: bool,
    /// Window-relative physical px (0 when `inside` is false).
    pub x: i32,
    pub y: i32,
}

/// The `pet-hover` decision for one 30 Hz sample: `Some(payload)` to emit, `None` to stay silent.
/// While the cursor is inside the window rect: a payload every sample. On leaving: one `inside: false`.
pub fn hover_step(was_inside: bool, rect: Option<Rect>, cursor: (i32, i32)) -> (bool, Option<HoverPayload>) {
    match rect {
        Some(r) if r.contains(cursor.0, cursor.1) => {
            (true, Some(HoverPayload { inside: true, x: cursor.0 - r.x, y: cursor.1 - r.y }))
        }
        _ if was_inside => (false, Some(HoverPayload { inside: false, x: 0, y: 0 })),
        _ => (false, None),
    }
}

/// 30 Hz poll of the cursor against the pet window rect; `emit` sends `pet-hover` to the page.
pub fn spawn_hover_thread<F: Fn(HoverPayload) + Send + 'static>(emit: F) {
    let _ = std::thread::Builder::new().name("pet-hover".into()).spawn(move || {
        let mut was_inside = false;
        let mut n: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let Some(hwnd) = pet_hwnd() else { continue };
            // Every ~0.5 s: Win+D leaves no foreground window at all (no EVENT_SYSTEM_FOREGROUND), so poll for it.
            n = n.wrapping_add(1);
            if n % 15 == 0 {
                let fg = unsafe { GetForegroundWindow() };
                let desktop = fg.0.is_null() || is_desktop_window(fg);
                if desktop != DESKTOP_IN_FRONT.swap(desktop, Ordering::SeqCst) && level() == Level::Desktop {
                    unsafe {
                        let _ = SetWindowPos(hwnd, Some(Level::Desktop.insert_after()), 0, 0, 0, 0,
                                             SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                }
            }
            let (rect, cursor) = unsafe {
                let mut p = POINT::default();
                let ok = GetCursorPos(&mut p).is_ok();
                let visible = IsWindowVisible(hwnd).as_bool();
                (if ok && visible { window_rect(hwnd) } else { None }, (p.x, p.y))
            };
            let (inside, payload) = hover_step(was_inside, rect, cursor);
            was_inside = inside;
            if let Some(p) = payload {
                emit(p);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_button_follows_swapped_buttons() {
        assert_eq!(primary_button_vk(false), 0x01); // VK_LBUTTON
        assert_eq!(primary_button_vk(true), 0x02); // VK_RBUTTON
    }

    #[test]
    fn idle_seconds_survives_tick_wraparound() {
        assert_eq!(idle_seconds(5_000, 2_000), 3.0);
        // clock wrapped between the last input and now: 1.5 s apart
        assert_eq!(idle_seconds(500, u32::MAX - 999), 1.5);
    }

    #[test]
    fn hover_emits_while_inside_and_once_on_leaving() {
        let r = Some(Rect { x: 100, y: 200, w: 150, h: 200 });
        let (inside, p) = hover_step(false, r, (110, 230));
        assert!(inside);
        assert_eq!(p, Some(HoverPayload { inside: true, x: 10, y: 30 }));
        // still inside: another payload (the alpha under the cursor can change while the pet animates)
        let (inside, p) = hover_step(true, r, (111, 231));
        assert!(inside && p.is_some());
        // left: exactly one inside:false
        let (inside, p) = hover_step(true, r, (5, 5));
        assert!(!inside);
        assert_eq!(p, Some(HoverPayload { inside: false, x: 0, y: 0 }));
        // still outside: silent
        let (inside, p) = hover_step(false, r, (5, 5));
        assert!(!inside && p.is_none());
        // window hidden / unknown rect while the cursor was "inside": also one inside:false
        let (inside, p) = hover_step(true, None, (110, 230));
        assert!(!inside && p == Some(HoverPayload { inside: false, x: 0, y: 0 }));
    }
}
