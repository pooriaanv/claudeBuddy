//! `ClaudeBuddy.exe --snapshot <out.png> [en|fa] [mode] [fontVariant]` (12-windows-plan.md D13).
//!
//! Port of the Mac `--snapshot` command: no pet window, no tray - one hidden webview (same `BROWSER_ARGS` as every
//! webview) loads `snapshot.html?lang=..&mode=..&font=..`, draws the sheet at DPR 1 and hands the PNG back through
//! `snapshot_done`; this module writes the file(s) and exits 0. A watchdog exits 1 after 30 s.
//!
//! - `mode`: `sheet` (default; also writes `<out>-menubar.png`) or `icon` (1024x1024 app icon)
//! - `fontVariant`: `nunito` (default) or `segoe` (renders the "rounded" text with Segoe UI, for comparing)

use base64::Engine as _;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// What the command line asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotArgs {
    pub out: PathBuf,
    pub lang: String,
    pub mode: String,
    pub font: String,
}

/// Parses `["ClaudeBuddy.exe", "--snapshot", out, lang?, mode?, font?]`. Unknown values fall back to the defaults, so
/// nothing from the command line ends up unchecked in the page URL.
pub fn parse_args(args: &[String]) -> Option<SnapshotArgs> {
    if args.get(1).map(String::as_str) != Some("--snapshot") {
        return None;
    }
    let out = PathBuf::from(args.get(2)?);
    let pick = |i: usize, allowed: &[&str], default: &str| -> String {
        match args.get(i) {
            Some(v) if allowed.contains(&v.as_str()) => v.clone(),
            _ => default.to_string(),
        }
    };
    Some(SnapshotArgs {
        out,
        lang: pick(3, &["en", "fa"], "en"),
        mode: pick(4, &["sheet", "icon", "moves", "inplace"], "sheet"),
        font: pick(5, &["nunito", "segoe"], "nunito"),
    })
}

/// `<out>.png` -> `<out>-menubar.png` (Mac: `path.replacingOccurrences(of: ".png", with: "-menubar.png")`).
pub fn menubar_path(out: &Path) -> PathBuf {
    let s = out.to_string_lossy();
    match s.strip_suffix(".png") {
        Some(stem) => PathBuf::from(format!("{stem}-menubar.png")),
        None => PathBuf::from(format!("{s}-menubar.png")),
    }
}

struct Job {
    out: PathBuf,
    mode: String,
}

/// Creates the one hidden webview and starts the 30 s watchdog.
pub fn start(app: &AppHandle, args: SnapshotArgs) -> Result<(), Box<dyn std::error::Error>> {
    let url = format!("snapshot.html?lang={}&mode={}&font={}", args.lang, args.mode, args.font);
    app.manage(Job { out: args.out, mode: args.mode });
    let mut builder = WebviewWindowBuilder::new(app, "snapshot", WebviewUrl::App(url.into()))
        .title("Claude Buddy snapshot")
        .visible(false)
        .focused(false)
        .inner_size(400.0, 300.0);
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(crate::BROWSER_ARGS);
    }
    builder.build()?;
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(30));
        eprintln!("snapshot: timed out after 30 s");
        std::process::exit(1);
    });
    Ok(())
}

fn write_png(path: &Path, base64_png: &str) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_png)
        .map_err(|e| format!("bad base64: {e}"))?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// The page finished drawing: write `<out.png>` (and `<out>-menubar.png` for the sheet) and exit 0.
#[tauri::command]
pub fn snapshot_done(app: AppHandle, png_base64: String, menubar_base64: Option<String>) -> Result<(), String> {
    let job = app.try_state::<Job>().ok_or("not started with --snapshot")?;
    let result = write_png(&job.out, &png_base64).and_then(|()| match (&menubar_base64, job.mode.as_str()) {
        (Some(png), "sheet") => write_png(&menubar_path(&job.out), png),
        _ => Ok(()),
    });
    match result {
        Ok(()) => {
            app.exit(0);
            Ok(())
        }
        Err(e) => {
            eprintln!("snapshot: {e}");
            std::process::exit(1);
        }
    }
}

/// The page failed (font load, drawing, ...): report and exit 1.
#[tauri::command]
pub fn snapshot_error(message: String) {
    eprintln!("snapshot: page error: {message}");
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_all_arguments() {
        let a = parse_args(&args(&["x.exe", "--snapshot", "out\\sheet.png", "fa", "icon", "segoe"])).unwrap();
        assert_eq!(a.lang, "fa");
        assert_eq!(a.mode, "icon");
        assert_eq!(a.font, "segoe");
        assert_eq!(a.out, PathBuf::from("out\\sheet.png"));
    }

    #[test]
    fn defaults_and_rejects_unknown_values() {
        let a = parse_args(&args(&["x.exe", "--snapshot", "o.png", "de", "../evil", "comic"])).unwrap();
        assert_eq!((a.lang.as_str(), a.mode.as_str(), a.font.as_str()), ("en", "sheet", "nunito"));
        assert!(parse_args(&args(&["x.exe"])).is_none());
        assert!(parse_args(&args(&["x.exe", "--snapshot"])).is_none());
    }

    #[test]
    fn menubar_file_name() {
        assert_eq!(menubar_path(Path::new("a/sheet-en.png")), PathBuf::from("a/sheet-en-menubar.png"));
        assert_eq!(menubar_path(Path::new("sheet")), PathBuf::from("sheet-menubar.png"));
    }
}
