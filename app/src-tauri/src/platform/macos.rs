//! macOS side of the pet window: the twin of windows.rs (port of PetWindow.swift `PetPanel` and the level changes
//! in PetController.swift).
//!
//! Geometry crosses the IPC in the same "physical px" as tao's monitor list: global points with a top-left origin
//! (primary screen), times the backing scale of the screen the point is on. AppKit wants bottom-left points, so every
//! frame / cursor goes through [`Screens`].
//!
//! AppKit calls run on the main thread (`run_on_main_thread`, or directly from synchronous commands, which Tauri
//! runs there). The hover thread only reads the cached screens and the last frame.

use crate::geometry::Rect;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::WebviewWindow;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut AnyObject;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const std::ffi::c_void);
}

const K_CG_DESKTOP_ICON_WINDOW_LEVEL_KEY: i32 = 18;
const NS_STATUS_WINDOW_LEVEL: isize = 25;
const NS_FLOATING_WINDOW_LEVEL: isize = 3;
const K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION: i32 = 0;
const K_CG_ANY_INPUT_EVENT_TYPE: u32 = u32::MAX;
const K_CG_WINDOW_LIST_ON_SCREEN_ONLY: u32 = 1 << 0;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP: u32 = 1 << 4;

// NSWindowCollectionBehavior: canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary (PetPanel).
const PET_COLLECTION_BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);

static PET: OnceLock<WebviewWindow> = OnceLock::new();

pub fn register_pet(window: WebviewWindow) {
    let _ = PET.set(window);
}

/// Runs `f` with the pet's `NSWindow` on the main thread.
fn with_ns_window(f: impl FnOnce(*mut AnyObject) + Send + 'static) {
    let Some(w) = PET.get() else { return };
    let Ok(ns) = w.ns_window() else { return };
    let ns = ns as usize;
    let _ = w.run_on_main_thread(move || f(ns as *mut AnyObject));
}

// ---------------------------------------------------------------------------------------------------------------
// Screens

#[derive(Clone, Copy, Debug)]
struct Screen {
    /// Top-left origin, points.
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    scale: f64,
}

#[derive(Default)]
struct Screens {
    list: Vec<Screen>,
    /// Height of the primary screen in points (the y flip).
    primary_h: f64,
}

static SCREENS: Mutex<Screens> = Mutex::new(Screens { list: Vec::new(), primary_h: 0.0 });

/// Reads `NSScreen.screens` into the cache. Main thread only.
fn refresh_screens() {
    let mut s = Screens::default();
    unsafe {
        let arr: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if arr.is_null() {
            return;
        }
        let n: usize = msg_send![arr, count];
        let mut raw = Vec::with_capacity(n);
        for i in 0..n {
            let screen: *mut AnyObject = msg_send![arr, objectAtIndex: i];
            let f: NSRect = msg_send![screen, frame];
            let scale: f64 = msg_send![screen, backingScaleFactor];
            raw.push((f, scale));
        }
        let Some((first, _)) = raw.first() else { return };
        s.primary_h = first.size.height;
        for (f, scale) in raw {
            s.list.push(Screen {
                x: f.origin.x,
                y: s.primary_h - (f.origin.y + f.size.height),
                w: f.size.width,
                h: f.size.height,
                scale,
            });
        }
    }
    *SCREENS.lock().unwrap() = s;
}

impl Screens {
    /// The screen a top-left point (in points) is on; the first screen when it is on none.
    fn at_points(&self, x: f64, y: f64) -> Option<Screen> {
        self.list
            .iter()
            .find(|s| x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h)
            .or(self.list.first())
            .copied()
    }

    /// The scale of the screen a physical point is on.
    fn scale_at_physical(&self, x: i32, y: i32) -> f64 {
        let (x, y) = (x as f64, y as f64);
        self.list
            .iter()
            .find(|s| x >= s.x * s.scale && x < (s.x + s.w) * s.scale && y >= s.y * s.scale && y < (s.y + s.h) * s.scale)
            .or(self.list.first())
            .map_or(1.0, |s| s.scale)
    }

    /// A physical rect as an AppKit frame (bottom-left points).
    fn ns_frame(&self, r: Rect) -> NSRect {
        let s = self.scale_at_physical(r.x, r.y);
        let (x, top, w, h) = (r.x as f64 / s, r.y as f64 / s, r.w as f64 / s, r.h as f64 / s);
        NSRect::new(NSPoint::new(x, self.primary_h - top - h), NSSize::new(w, h))
    }

    /// The cursor in physical px.
    fn cursor(&self) -> (i32, i32) {
        let p: NSPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
        let (x, y) = (p.x, self.primary_h - p.y);
        let s = self.at_points(x, y).map_or(1.0, |s| s.scale);
        ((x * s).round() as i32, (y * s).round() as i32)
    }

    /// A physical point in top-left points.
    fn to_points(&self, x: i32, y: i32) -> (f64, f64) {
        let s = self.scale_at_physical(x, y);
        (x as f64 / s, y as f64 / s)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Window style (PetPanel.init)

/// Applies the PetPanel properties to tao's window. Starts click-through, like Windows (D6).
pub fn apply_pet_style() {
    with_ns_window(|ns| unsafe {
        refresh_screens();
        let _: () = msg_send![ns, setCollectionBehavior: PET_COLLECTION_BEHAVIOR];
        let _: () = msg_send![ns, setHidesOnDeactivate: false];
        let _: () = msg_send![ns, setHasShadow: false];
        let _: () = msg_send![ns, setOpaque: false];
        let _: () = msg_send![ns, setIgnoresMouseEvents: true];
    });
}

/// `orderFrontRegardless`: shows the window without activating the app.
pub fn show_no_activate() {
    with_ns_window(|ns| unsafe {
        let _: () = msg_send![ns, orderFrontRegardless];
    });
}

/// `true`: mouse clicks pass through to the windows behind the pet (D6).
pub fn set_click_through(enabled: bool) {
    with_ns_window(move |ns| unsafe {
        let _: () = msg_send![ns, setIgnoresMouseEvents: enabled];
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Z-order (D8)

/// Same three levels as windows.rs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// Idle: desktop icon level + 1 (Swift `desktopLevel`), behind every app window.
    Desktop = 0,
    /// Knocking / dragging: `.statusBar`.
    Front = 1,
    /// Windows addition: dropped over an app window, in front of every app (`.floating`) until dropped on the
    /// desktop again.
    Above = 2,
}

static PINNED: AtomicBool = AtomicBool::new(false);
static LEVEL: AtomicU8 = AtomicU8::new(Level::Desktop as u8);

impl Level {
    pub fn parse(s: &str) -> Option<Level> {
        match s {
            "desktop" if PINNED.load(Ordering::SeqCst) => Some(Level::Above),
            "desktop" => Some(Level::Desktop),
            "front" => Some(Level::Front),
            _ => None,
        }
    }

    fn ns_level(self) -> isize {
        match self {
            Level::Desktop => unsafe { CGWindowLevelForKey(K_CG_DESKTOP_ICON_WINDOW_LEVEL_KEY) as isize + 1 },
            Level::Front => NS_STATUS_WINDOW_LEVEL,
            Level::Above => NS_FLOATING_WINDOW_LEVEL,
        }
    }
}

pub fn level() -> Level {
    match LEVEL.load(Ordering::SeqCst) {
        1 => Level::Front,
        2 => Level::Above,
        _ => Level::Desktop,
    }
}

pub fn set_level(level: Level) {
    LEVEL.store(level as u8, Ordering::SeqCst);
    let ns_level = level.ns_level();
    with_ns_window(move |ns| unsafe {
        let _: () = msg_send![ns, setLevel: ns_level];
        if level != Level::Desktop {
            let _: () = msg_send![ns, orderFrontRegardless];
        }
    });
}

/// One on-screen window as the window server reports it (owner and bounds need no screen-recording permission).
struct WindowInfo {
    pid: i64,
    layer: f64,
    alpha: f64,
    /// Top-left points.
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// `CGWindowListCopyWindowInfo(onScreenOnly | excludeDesktopElements)`, front to back.
fn on_screen_windows() -> Vec<WindowInfo> {
    let mut out = Vec::new();
    unsafe {
        let list = CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP, 0);
        if list.is_null() {
            return out;
        }
        let get = |dict: *mut AnyObject, key: &str| -> *mut AnyObject {
            let key = objc2_foundation::NSString::from_str(key);
            msg_send![dict, objectForKey: &*key]
        };
        let num = |dict: *mut AnyObject, key: &str| -> f64 {
            let v = get(dict, key);
            if v.is_null() { f64::NAN } else { msg_send![v, doubleValue] }
        };
        let n: usize = msg_send![list, count];
        for i in 0..n {
            let info: *mut AnyObject = msg_send![list, objectAtIndex: i];
            let b = get(info, "kCGWindowBounds");
            if b.is_null() {
                continue;
            }
            let alpha = num(info, "kCGWindowAlpha");
            out.push(WindowInfo {
                pid: num(info, "kCGWindowOwnerPID") as i64,
                layer: num(info, "kCGWindowLayer"),
                alpha: if alpha.is_nan() { 1.0 } else { alpha },
                x: num(b, "X"),
                y: num(b, "Y"),
                w: num(b, "Width"),
                h: num(b, "Height"),
            });
        }
        CFRelease(list as *const std::ffi::c_void);
    }
    out
}

/// True when a normal app window (layer 0, another process, at least 80×80 pt) is under the top-left point.
fn app_window_under(x: f64, y: f64) -> bool {
    let own_pid = std::process::id() as i64;
    // Front to back: the first window containing the point decides.
    on_screen_windows().iter().any(|w| {
        w.layer == 0.0
            && w.pid != own_pid
            && w.w >= 80.0
            && w.h >= 80.0
            && x >= w.x
            && y >= w.y
            && x < w.x + w.w
            && y < w.y + w.h
    })
}

/// End of a drag: over an app window -> `Above`; over the desktop or the Dock -> `Desktop`.
pub fn drop_level(x: i32, y: i32) {
    let (px, py) = SCREENS.lock().unwrap().to_points(x, y);
    let over_app = app_window_under(px, py);
    PINNED.store(over_app, Ordering::SeqCst);
    set_level(if over_app { Level::Above } else { Level::Desktop });
    crate::dev::log(&format!("drop at ({x},{y}) over app={over_app} level={:?}", level()));
}

// ---------------------------------------------------------------------------------------------------------------
// Frame

static FRAME: Mutex<Option<Rect>> = Mutex::new(None);

/// One `setFrame:display:` (move + resize together), physical px in.
pub fn set_frame(f: Rect) {
    *FRAME.lock().unwrap() = Some(f);
    with_ns_window(move |ns| unsafe {
        let frame = SCREENS.lock().unwrap().ns_frame(f);
        let _: () = msg_send![ns, setFrame: frame, display: true];
    });
}

/// Re-reads the screens (call when the monitor list changed).
pub fn screens_changed() {
    with_ns_window(|_| refresh_screens());
}

// ---------------------------------------------------------------------------------------------------------------
// Pointer (D7): `NSEvent.mouseLocation`, the left button, `Focus.userIdleSeconds()`

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PointerState {
    pub x: i32,
    pub y: i32,
    pub left_down: bool,
    pub idle_secs: f64,
}

pub fn idle_seconds() -> f64 {
    unsafe { CGEventSourceSecondsSinceLastEventType(K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION, K_CG_ANY_INPUT_EVENT_TYPE) }
}

pub fn pointer_state() -> PointerState {
    let (x, y) = SCREENS.lock().unwrap().cursor();
    let buttons: usize = unsafe { msg_send![class!(NSEvent), pressedMouseButtons] };
    PointerState { x, y, left_down: buttons & 1 != 0, idle_secs: idle_seconds() }
}

// ---------------------------------------------------------------------------------------------------------------
// Hover thread (D6)

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct HoverPayload {
    pub inside: bool,
    pub x: i32,
    pub y: i32,
}

/// 30 Hz poll of the cursor against the last pet frame; `emit` sends `pet-hover` to the page.
pub fn spawn_hover_thread<F: Fn(HoverPayload) + Send + 'static>(emit: F) {
    let _ = std::thread::Builder::new().name("pet-hover".into()).spawn(move || {
        let mut was_inside = false;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let rect = *FRAME.lock().unwrap();
            let (cx, cy) = SCREENS.lock().unwrap().cursor();
            match rect {
                Some(r) if r.contains(cx, cy) => {
                    was_inside = true;
                    emit(HoverPayload { inside: true, x: cx - r.x, y: cy - r.y });
                }
                _ if was_inside => {
                    was_inside = false;
                    emit(HoverPayload { inside: false, x: 0, y: 0 });
                }
                _ => {}
            }
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Quiet when watching (Focus.isWatching)

/// Same shape as windows' `foreground::ForegroundCheck`; the page combines the fields (coordinator.ts).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundCheck {
    /// The frontmost app is the bundle `host` (`/Applications/Claude.app`).
    pub same_exe: bool,
    /// The frontmost app is hidden (Cmd-H).
    pub minimized: bool,
    /// The topmost normal window on screen belongs to the frontmost app (a minimized app has none).
    pub top_owner_is_foreground: bool,
    pub idle_secs: f64,
}

fn same_path(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.trim_end_matches('/') == b.trim_end_matches('/'),
    }
}

/// `ScreenWindows.frontmostOwner`: the owner of the first layer-0, visible, at least 80×80 window.
fn frontmost_owner() -> Option<i64> {
    on_screen_windows()
        .into_iter()
        .find(|w| w.layer == 0.0 && w.alpha > 0.05 && w.w >= 80.0 && w.h >= 80.0)
        .map(|w| w.pid)
}

/// Port of `Focus.isWatching` minus the dedicated-app and idle rules, which the page applies.
pub fn foreground_check(host: &str) -> ForegroundCheck {
    let idle_secs = idle_seconds();
    let none = ForegroundCheck { same_exe: false, minimized: false, top_owner_is_foreground: false, idle_secs };
    unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return none;
        }
        let url: *mut AnyObject = msg_send![app, bundleURL];
        let path: *mut AnyObject = if url.is_null() { url } else { msg_send![url, path] };
        let front = if path.is_null() { String::new() } else { (*(path as *const objc2_foundation::NSString)).to_string() };
        let pid: i32 = msg_send![app, processIdentifier];
        let hidden: bool = msg_send![app, isHidden];
        let top = frontmost_owner();
        crate::dev::log(&format!("foreground: front={front} pid={pid} hidden={hidden} top={top:?} idle={idle_secs:.1}s"));
        ForegroundCheck {
            same_exe: !front.is_empty() && same_path(&front, host),
            minimized: hidden,
            top_owner_is_foreground: top == Some(pid as i64),
            idle_secs,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live check against the real desktop (explicit run only): prints what the pet would see for Claude.app.
    /// `cargo test live_foreground_check -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_foreground_check() {
        println!("{:?}", foreground_check("/Applications/Claude.app"));
    }
}
