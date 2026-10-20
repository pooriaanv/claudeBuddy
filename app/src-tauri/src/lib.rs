mod agents;
mod dev; // BUDDY_DEBUG logging
mod geometry;
mod hooks;
mod inbox;
mod paths;
mod pet;
mod platform;
mod screens;
mod snapshot;
mod tray;

/// 12-windows-plan.md D3: no WebView2 throttling of the (mostly occluded) pet page. Every webview of the app uses
/// the same args. The first three features are wry's defaults, which `additional_browser_args` replaces.
#[cfg(windows)]
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
--autoplay-policy=no-user-gesture-required";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli: Vec<String> = std::env::args().collect();
    if let Some(code) = agents::cli(&cli) {
        std::process::exit(code);
    }
    let snapshot_args = snapshot::parse_args(&cli);
    // Linux: the pet needs X11 window management (keep-below / keep-above, input shapes, the stacking order), which
    // Wayland does not give clients. On a Wayland session, run through XWayland unless the user chose a backend.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_some() {
        // SAFETY: still single-threaded here, before GTK or any thread starts.
        unsafe { std::env::set_var("GDK_BACKEND", "x11") };
    }
    let mut builder = tauri::Builder::default();
    // Single instance only for the real app: `--snapshot` must run while the installed app is running.
    if snapshot_args.is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {}));
    }
    builder
        // Prefs (D14): the page reads / writes prefs.json through this plugin.
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(move |app| {
            // No Dock icon, never the active app (main.swift `setActivationPolicy(.accessory)`).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            match snapshot_args {
                // `--snapshot`: no pet window, no tray - one hidden webview that draws the sheet (D13).
                Some(args) => snapshot::start(app.handle(), args)?,
                None => {
                    pet::create_window(app.handle())?;
                    agents::start(app.handle());
                    tray::create(app.handle())?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pet::monitors,
            pet::pointer_state,
            pet::set_pet_frame,
            pet::set_pet_level,
            pet::drop_pet_level,
            pet::set_click_through,
            pet::pet_ready,
            agents::set_active_marker,
            tray::set_tray,
            tray::open_settings,
            tray::set_settings_title,
            tray::settings_action,
            tray::quit,
            agents::foreground_check,
            agents::hooks_status,
            agents::hooks_connect,
            agents::hooks_disconnect,
            snapshot::snapshot_done,
            snapshot::snapshot_error,
            dev::debug_config,
            dev::debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
