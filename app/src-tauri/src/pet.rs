//! The pet window: creation and the commands the page calls (12-windows-plan.md D2, D5-D8, section 3).

use crate::dev;
use crate::geometry::{self, Rect};
use crate::screens::{self, MonitorDto};
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

pub const PET_LABEL: &str = "pet";

/// Every monitor in physical pixels with its work area and scale.
#[tauri::command]
pub fn monitors(app: tauri::AppHandle) -> Result<Vec<MonitorDto>, String> {
    screens::collect(&app)
}

/// `{x, y, leftDown, idleSecs}`: cursor (global physical px), primary button, seconds since the last input.
#[cfg(windows)]
#[tauri::command]
pub fn pointer_state() -> crate::platform::windows::PointerState {
    crate::platform::windows::pointer_state()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn pointer_state() -> crate::platform::macos::PointerState {
    crate::platform::macos::pointer_state()
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn pointer_state() -> crate::platform::linux::PointerState {
    crate::platform::linux::pointer_state()
}

/// One `SetWindowPos` in physical px (move + resize together; never re-orders, never activates).
#[tauri::command]
pub fn set_pet_frame(x: i32, y: i32, w: i32, h: i32) {
    #[cfg(windows)]
    if let Some(hwnd) = crate::platform::windows::pet_hwnd() {
        crate::platform::windows::set_frame(hwnd, Rect { x, y, w, h });
    }
    #[cfg(target_os = "macos")]
    crate::platform::macos::set_frame(Rect { x, y, w, h });
    #[cfg(target_os = "linux")]
    crate::platform::linux::set_frame(Rect { x, y, w, h });
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = (x, y, w, h);
}

/// `"desktop"` (behind every window, idle) or `"front"` (above everything, knocking). D8.
/// End of a drag (Windows addition): above the app window under the cursor, or desktop level.
#[tauri::command]
pub fn drop_pet_level(x: i32, y: i32) {
    #[cfg(windows)]
    if let Some(hwnd) = crate::platform::windows::pet_hwnd() {
        crate::platform::windows::drop_level(hwnd, x, y);
    }
    #[cfg(target_os = "macos")]
    crate::platform::macos::drop_level(x, y);
    #[cfg(target_os = "linux")]
    crate::platform::linux::drop_level(x, y);
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = (x, y);
}

#[tauri::command]
pub fn set_pet_level(level: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use crate::platform::windows as w;
        let level = w::Level::parse(&level).ok_or_else(|| format!("unknown level: {level}"))?;
        if let Some(hwnd) = w::pet_hwnd() {
            w::set_level(hwnd, level);
        }
    }
    #[cfg(target_os = "macos")]
    {
        use crate::platform::macos as m;
        m::set_level(m::Level::parse(&level).ok_or_else(|| format!("unknown level: {level}"))?);
    }
    #[cfg(target_os = "linux")]
    {
        use crate::platform::linux as l;
        l::set_level(l::Level::parse(&level).ok_or_else(|| format!("unknown level: {level}"))?);
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = level;
    Ok(())
}

/// `true`: mouse clicks pass through to the windows behind the pet (D6).
#[tauri::command]
pub fn set_click_through(enabled: bool) {
    #[cfg(windows)]
    if let Some(hwnd) = crate::platform::windows::pet_hwnd() {
        crate::platform::windows::set_click_through(hwnd, enabled);
    }
    #[cfg(target_os = "macos")]
    crate::platform::macos::set_click_through(enabled);
    #[cfg(target_os = "linux")]
    crate::platform::linux::set_click_through(enabled);
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = enabled;
}

/// The first frame is drawn: show the window without activating it (D2), at the current level.
#[tauri::command]
pub fn pet_ready() {
    #[cfg(windows)]
    if let Some(hwnd) = crate::platform::windows::pet_hwnd() {
        use crate::platform::windows as w;
        w::show_no_activate(hwnd);
        // The window subclass already keeps the level through the show; this is the belt-and-braces re-apply.
        w::set_level(hwnd, w::level());
        dev::log(&format!("pet_ready: exstyle=0x{:08x} rect={:?} level={:?}", w::ex_style(hwnd), w::window_rect(hwnd), w::level()));
    }
    #[cfg(target_os = "macos")]
    {
        use crate::platform::macos as m;
        m::show_no_activate();
        m::set_level(m::level());
        dev::log(&format!("pet_ready: level={:?}", m::level()));
    }
    #[cfg(target_os = "linux")]
    {
        use crate::platform::linux as l;
        l::show_no_activate();
        l::set_level(l::level());
        dev::log(&format!("pet_ready: level={:?}", l::level()));
    }
}

fn rect_of(wa: &tauri::PhysicalRect<i32, u32>) -> Rect {
    Rect { x: wa.position.x, y: wa.position.y, w: wa.size.width as i32, h: wa.size.height as i32 }
}

/// Creates the pet window hidden, styles it, installs the subclass and puts it on the floor of the primary monitor
/// (port of `PetController.start` + `PetWindow.PetPanel`, D2/D5). The page moves it to its own idle frame
/// (saved `petX`, `size` pref) before it calls `pet_ready`.
pub fn create_window(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let monitor = match app.primary_monitor()? {
        Some(m) => m,
        None => app.available_monitors()?.into_iter().next().ok_or("no monitor")?,
    };
    let scale = monitor.scale_factor();
    let work = rect_of(monitor.work_area());
    let frame = geometry::idle_frame(work, scale, geometry::DEFAULT_SIZE_PT, geometry::default_center_x(work, scale));

    // No always_on_bottom here: the z-order is ours (window subclass + `set_pet_level`), tao's flag setters rewrite
    // the ex-style (see platform/windows.rs).
    let window = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::App("index.html".into()))
        .title("Claude Buddy")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false) // shown by `pet_ready` after the first frame (no white flash)
        .inner_size(
            geometry::DEFAULT_SIZE_PT,
            geometry::DEFAULT_SIZE_PT * geometry::DESIGN_HEIGHT / geometry::DESIGN_WIDTH,
        );
    #[cfg(windows)]
    let window = window.additional_browser_args(crate::BROWSER_ARGS);
    // The pet window is never key, so the first click must reach the page (PetHostView.acceptsFirstMouse).
    #[cfg(target_os = "macos")]
    let window = window.accept_first_mouse(true);
    let window = window.build()?;

    #[cfg(windows)]
    {
        use crate::platform::windows as w;
        let hwnd = window.hwnd()?;
        w::register_pet(hwnd);
        // After the last tao call that changes window flags. Starts click-through (D6): the page makes the opaque
        // pixels of the pet interactive.
        let ex = w::apply_pet_ex_style(hwnd, true);
        let subclassed = w::install_pet_subclass(hwnd);
        w::install_desktop_watch();
        w::set_level(hwnd, w::Level::Desktop);
        w::set_frame(hwnd, frame);
        dev::log(&format!(
            "pet window: exstyle=0x{ex:08x} subclass={subclassed} frame={frame:?} actual={:?} rcWork={:?}",
            w::window_rect(hwnd),
            w::primary_rc_work()
        ));
        let handle = app.clone();
        w::spawn_hover_thread(move |p| {
            let _ = handle.emit_to(PET_LABEL, "pet-hover", p);
        });
    }
    #[cfg(target_os = "macos")]
    {
        use crate::platform::macos as m;
        m::quit_other_copies(&app.config().identifier);
        m::register_pet(window);
        m::apply_pet_style();
        m::set_level(m::Level::Desktop);
        m::set_frame(frame);
        dev::log(&format!("pet window: frame={frame:?}"));
        let handle = app.clone();
        m::spawn_hover_thread(move |p| {
            let _ = handle.emit_to(PET_LABEL, "pet-hover", p);
        });
    }
    #[cfg(target_os = "linux")]
    {
        use crate::platform::linux as l;
        l::register_pet(window);
        l::set_click_through(true);
        l::set_level(l::Level::Desktop);
        l::set_frame(frame);
        dev::log(&format!("pet window: frame={frame:?}"));
        let handle = app.clone();
        l::spawn_hover_thread(move |p| {
            let _ = handle.emit_to(PET_LABEL, "pet-hover", p);
        });
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = (window, frame);

    screens::spawn_watcher(app.clone());
    Ok(())
}
