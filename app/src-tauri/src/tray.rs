//! Tray icon + menu (port of StatusMenu.swift) and the settings window (port of SettingsWindowController).
//! The menu model and the face PNG come from the pet page (TS owns l10n, prefs and the waiting list); clicks go back
//! as `tray-action {id}`.

use crate::paths::BuddyPaths;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const TRAY_ID: &str = "main";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayItem {
    /// "item" | "check" | "separator"
    kind: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    checked: bool,
}

fn yes() -> bool {
    true
}

#[derive(Serialize, Clone)]
struct TrayAction {
    id: String,
}

/// Creates the tray once (setup). Mac: clicking the menu-bar item opens the menu → left click opens it here too.
pub fn create(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Claude Buddy")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, e| {
            let _ = app.emit_to("pet", "tray-action", TrayAction { id: e.id().0.clone() });
        })
        .build(app)?;
    Ok(())
}

/// Rebuilds menu + icon (StatusMenu.rebuild). `png` is base64 of the face image (badge baked in).
#[tauri::command]
pub fn set_tray(app: tauri::AppHandle, items: Vec<TrayItem>, png: String) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("no tray")?;
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    for it in &items {
        match it.kind.as_str() {
            "separator" => menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?),
            "check" => menu.append(
                &CheckMenuItem::with_id(&app, &it.id, &it.label, it.enabled, it.checked, None::<&str>)
                    .map_err(|e| e.to_string())?,
            ),
            _ => menu.append(
                &MenuItem::with_id(&app, &it.id, &it.label, it.enabled, None::<&str>).map_err(|e| e.to_string())?,
            ),
        }
        .map_err(|e| e.to_string())?;
    }
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(png) {
        if let Ok(img) = Image::from_bytes(&bytes) {
            tray.set_icon(Some(img)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// SettingsWindowController.show: 520×440, never taller than the work area − 120, min 440×300, centered, focused.
/// async: building a window inside a synchronous command deadlocks the event loop on Windows (the tray hang).
#[tauri::command]
pub async fn open_settings(app: tauri::AppHandle, title: String) -> Result<(), String> {
    open_settings_tab(app, title, None)
}

/// `tab` (0-3) is for the DEBUG (P5) `BUDDY_DEBUG_SETTINGS=<tab>` screenshots only.
pub fn open_settings_tab(app: tauri::AppHandle, title: String, tab: Option<u8>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let work_h = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.work_area().size.height as f64 / m.scale_factor())
        .unwrap_or(800.0);
    let h = (work_h - 120.0).clamp(300.0, 440.0);
    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(match tab { Some(t) => format!("settings.html?tab={t}").into(), None => "settings.html".into() }))
        .title(title)
        .inner_size(520.0, h)
        .min_inner_size(440.0, 300.0)
        .resizable(true)
        .center()
        .focused(true);
    #[cfg(windows)]
    let builder = builder.additional_browser_args(crate::BROWSER_ARGS);
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_settings_title(app: tauri::AppHandle, title: String) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.set_title(&title);
    }
}

/// Settings → pet: "Try a knock" etc. go to the pet page, which owns the Coordinator.
#[tauri::command]
pub fn settings_action(app: tauri::AppHandle, id: String) {
    let _ = app.emit_to("pet", "tray-action", TrayAction { id });
}

/// StatusMenu.quit: active marker off, exit.
#[tauri::command]
pub fn quit(app: tauri::AppHandle) {
    BuddyPaths::current().set_active(false);
    app.exit(0);
}
