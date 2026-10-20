//! Linux side of the pet window (X11, or XWayland): the twin of windows.rs / macos.rs.
//!
//! Window changes go through tao (GTK): keep-below / keep-above for the levels, an empty input shape for
//! click-through, move + resize in physical px. Queries go straight to the X server with x11rb on a connection of our
//! own (thread-safe, no GTK main-thread round trip): the cursor and its buttons, idle time (MIT-SCREEN-SAVER), the
//! stacking order (`_NET_CLIENT_LIST_STACKING`) and the active window (`_NET_ACTIVE_WINDOW`).
//! X root coordinates are device pixels, the same "physical px" the page and tao's monitor list use.

use crate::geometry::Rect;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};
use x11rb::connection::Connection;
use x11rb::protocol::screensaver::ConnectionExt as _;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt as _, KeyButMask, Window};
use x11rb::rust_connection::RustConnection;

static PET: OnceLock<WebviewWindow> = OnceLock::new();

pub fn register_pet(window: WebviewWindow) {
    let _ = PET.set(window);
}

// ---------------------------------------------------------------------------------------------------------------
// X connection

struct X {
    conn: RustConnection,
    root: Window,
}

impl X {
    fn connect() -> Option<X> {
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen)?.root;
        Some(X { conn, root })
    }

    fn atom(&self, name: &str) -> Option<Atom> {
        Some(self.conn.intern_atom(false, name.as_bytes()).ok()?.reply().ok()?.atom)
    }

    /// A 32-bit list property (windows, atoms, cardinals).
    fn u32s(&self, win: Window, prop: &str, ty: AtomEnum) -> Vec<u32> {
        let Some(prop) = self.atom(prop) else { return Vec::new() };
        self.conn
            .get_property(false, win, prop, ty, 0, 4096)
            .ok()
            .and_then(|c| c.reply().ok())
            .and_then(|r| r.value32().map(|v| v.collect()))
            .unwrap_or_default()
    }

    fn pid(&self, win: Window) -> Option<u32> {
        self.u32s(win, "_NET_WM_PID", AtomEnum::CARDINAL).first().copied()
    }

    fn has_state(&self, win: Window, state: &str) -> bool {
        let Some(want) = self.atom(state) else { return false };
        self.u32s(win, "_NET_WM_STATE", AtomEnum::ATOM).contains(&want)
    }

    /// A normal app window: no type, or `_NET_WM_WINDOW_TYPE_NORMAL` / `_DIALOG` (not the desktop, docks, panels).
    fn is_normal(&self, win: Window) -> bool {
        let types = self.u32s(win, "_NET_WM_WINDOW_TYPE", AtomEnum::ATOM);
        if types.is_empty() {
            return true;
        }
        ["_NET_WM_WINDOW_TYPE_NORMAL", "_NET_WM_WINDOW_TYPE_DIALOG"]
            .iter()
            .filter_map(|n| self.atom(n))
            .any(|a| types.contains(&a))
    }

    /// The window's outer rect in root coordinates.
    fn rect(&self, win: Window) -> Option<Rect> {
        let g = self.conn.get_geometry(win).ok()?.reply().ok()?;
        let t = self.conn.translate_coordinates(win, self.root, 0, 0).ok()?.reply().ok()?;
        Some(Rect { x: t.dst_x as i32, y: t.dst_y as i32, w: g.width as i32, h: g.height as i32 })
    }

    /// Managed windows, front to back.
    fn stacking_front_to_back(&self) -> Vec<Window> {
        let mut list = self.u32s(self.root, "_NET_CLIENT_LIST_STACKING", AtomEnum::WINDOW);
        list.reverse();
        list
    }

    fn pointer(&self) -> (i32, i32, bool) {
        match self.conn.query_pointer(self.root).ok().and_then(|c| c.reply().ok()) {
            Some(p) => (p.root_x as i32, p.root_y as i32, p.mask.contains(KeyButMask::BUTTON1)),
            None => (0, 0, false),
        }
    }

    fn idle_seconds(&self) -> f64 {
        self.conn
            .screensaver_query_info(self.root)
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|i| i.ms_since_user_input as f64 / 1000.0)
            .unwrap_or(0.0)
    }
}

/// One shared connection for the commands (the hover thread opens its own).
fn shared() -> Option<&'static X> {
    static CONN: OnceLock<Option<X>> = OnceLock::new();
    CONN.get_or_init(X::connect).as_ref()
}

// ---------------------------------------------------------------------------------------------------------------
// Window

/// Click-through wanted by the page; applied once the window is mapped (tao needs its GDK window for the input
/// shape and panics without one).
static CLICK_THROUGH: AtomicBool = AtomicBool::new(true);
static SHOWN: AtomicBool = AtomicBool::new(false);

pub fn show_no_activate() {
    if let Some(w) = PET.get() {
        // The window is built with focusable(false), so GTK maps it without taking the focus.
        let _ = w.show();
        SHOWN.store(true, Ordering::SeqCst);
        let _ = w.set_ignore_cursor_events(CLICK_THROUGH.load(Ordering::SeqCst));
    }
}

/// `true`: mouse clicks pass through to the windows behind the pet (D6): an empty input shape.
pub fn set_click_through(enabled: bool) {
    CLICK_THROUGH.store(enabled, Ordering::SeqCst);
    if !SHOWN.load(Ordering::SeqCst) {
        return;
    }
    if let Some(w) = PET.get() {
        let _ = w.set_ignore_cursor_events(enabled);
    }
}

static FRAME: Mutex<Option<Rect>> = Mutex::new(None);

/// Move + resize, physical px.
pub fn set_frame(f: Rect) {
    *FRAME.lock().unwrap() = Some(f);
    if let Some(w) = PET.get() {
        let _ = w.set_size(PhysicalSize::new(f.w.max(1) as u32, f.h.max(1) as u32));
        let _ = w.set_position(PhysicalPosition::new(f.x, f.y));
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Z-order (D8)

/// Same three levels as windows.rs / macos.rs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// Idle: keep-below (`_NET_WM_STATE_BELOW`), behind every app window, above the desktop.
    Desktop = 0,
    /// Knocking / dragging: keep-above.
    Front = 1,
    /// Dropped over an app window: keep-above until dropped on the desktop again.
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
    if let Some(w) = PET.get() {
        let below = level == Level::Desktop;
        // Clear one before setting the other: the window manager treats above + below as "below".
        if below {
            let _ = w.set_always_on_top(false);
            let _ = w.set_always_on_bottom(true);
        } else {
            let _ = w.set_always_on_bottom(false);
            let _ = w.set_always_on_top(true);
        }
    }
}

/// True when a normal, visible app window of another process (at least 80×80 px) is under the point.
fn app_window_under(x: &X, px: i32, py: i32) -> bool {
    let own = std::process::id();
    for win in x.stacking_front_to_back() {
        if x.pid(win) == Some(own) || !x.is_normal(win) || x.has_state(win, "_NET_WM_STATE_HIDDEN") {
            continue;
        }
        let Some(r) = x.rect(win) else { continue };
        if r.w >= 80 && r.h >= 80 && r.contains(px, py) {
            return true;
        }
    }
    false
}

/// End of a drag: over an app window -> `Above`; over the desktop or a panel -> `Desktop`.
pub fn drop_level(x: i32, y: i32) {
    let over_app = shared().is_some_and(|c| app_window_under(c, x, y));
    PINNED.store(over_app, Ordering::SeqCst);
    set_level(if over_app { Level::Above } else { Level::Desktop });
    crate::dev::log(&format!("drop at ({x},{y}) over app={over_app} level={:?}", level()));
}

// ---------------------------------------------------------------------------------------------------------------
// Pointer (D7)

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PointerState {
    pub x: i32,
    pub y: i32,
    pub left_down: bool,
    pub idle_secs: f64,
}

pub fn pointer_state() -> PointerState {
    match shared() {
        Some(c) => {
            let (x, y, left_down) = c.pointer();
            PointerState { x, y, left_down, idle_secs: c.idle_seconds() }
        }
        None => PointerState { x: 0, y: 0, left_down: false, idle_secs: 0.0 },
    }
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
        let Some(x) = X::connect() else {
            crate::dev::log("hover: no X display (Wayland without XWayland?)");
            return;
        };
        let mut was_inside = false;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let rect = *FRAME.lock().unwrap();
            let (cx, cy, _) = x.pointer();
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

/// Same shape as the Windows / macOS ones; the page combines the fields (coordinator.ts).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundCheck {
    /// The active window's process runs the executable `host`.
    pub same_exe: bool,
    /// The active window is minimized.
    pub minimized: bool,
    /// The topmost normal, visible window belongs to the active window's process.
    pub top_owner_is_foreground: bool,
    pub idle_secs: f64,
}

fn exe_of(pid: u32) -> Option<std::path::PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

fn same_path(a: &std::path::Path, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == std::path::Path::new(b),
    }
}

pub fn foreground_check(host: &str) -> ForegroundCheck {
    let Some(x) = shared() else {
        return ForegroundCheck { same_exe: false, minimized: false, top_owner_is_foreground: false, idle_secs: 0.0 };
    };
    let idle_secs = x.idle_seconds();
    let active = x.u32s(x.root, "_NET_ACTIVE_WINDOW", AtomEnum::WINDOW).first().copied().unwrap_or(0);
    let pid = if active == 0 { None } else { x.pid(active) };
    let exe = pid.and_then(exe_of);
    let top = x
        .stacking_front_to_back()
        .into_iter()
        .find(|&w| {
            x.is_normal(w)
                && !x.has_state(w, "_NET_WM_STATE_HIDDEN")
                && x.rect(w).is_some_and(|r| r.w >= 80 && r.h >= 80)
        })
        .and_then(|w| x.pid(w));
    crate::dev::log(&format!("foreground: active={active:#x} pid={pid:?} exe={exe:?} top={top:?} idle={idle_secs:.1}s"));
    ForegroundCheck {
        same_exe: exe.as_deref().is_some_and(|e| same_path(e, host)),
        minimized: active != 0 && x.has_state(active, "_NET_WM_STATE_HIDDEN"),
        top_owner_is_foreground: pid.is_some() && top == pid,
        idle_secs,
    }
}
