//! The flow of `notify.sh`, with the operating-system parts behind the `System` trait so it can be unit tested.

use crate::{cli, event};
use std::fs;
use std::path::{Path, PathBuf};

/// What the helper needs from the machine it runs on.
pub trait System {
    /// The hook JSON from stdin; empty when stdin is a console (notify.sh: `[ ! -t 0 ]`) or has nothing.
    fn read_stdin(&mut self) -> Vec<u8>;
    /// Full exe path of the GUI app this session runs in (`host_app`).
    fn find_host(&mut self) -> Option<String>;
    /// Does the buddy app hold its "running" mutex? (notify.sh: `pgrep -xq ClaudeBuddy`)
    fn app_running(&mut self) -> bool;
    /// Start the app detached from this process and its job (notify.sh: `open -g -b com.pooria.claudebuddy`).
    fn launch(&mut self, exe: &Path);
}

/// `BUDDY_HOME` when set and non-empty (tests, debugging), else the user profile.
pub fn home_dir(buddy_home: Option<std::ffi::OsString>, user_profile: Option<std::ffi::OsString>) -> Option<PathBuf> {
    [buddy_home, user_profile]
        .into_iter()
        .flatten()
        .find(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Port of the body of notify.sh. Never fails: every error just ends the work early (the script ignores them
/// too, and an agent hook must not break the agent).
pub fn run(args: &[String], home: &Path, unix_secs: u64, pid: u32, sys: &mut dyn System) {
    let inv = cli::parse(args);
    let root = home.join(".claude-buddy"); // dir="$HOME/.claude-buddy"
    let dismiss = inv.event == "dismiss";

    // if [ "$event" = "dismiss" ] && [ ! -f "$dir/active" ]; then read_payload >/dev/null; exit 0; fi
    if dismiss && !root.join("active").is_file() {
        let _ = read_payload(&inv, sys);
        return;
    }

    // mkdir -p "$dir/inbox"; f="$dir/inbox/$(date +%s)-$$"
    let inbox = root.join("inbox");
    let _ = fs::create_dir_all(&inbox);
    let base = event::base_name(unix_secs, pid);
    let tmp = inbox.join(format!("{base}.tmp"));
    let evt = inbox.join(format!("{base}.evt"));

    // { echo "$agent $event"; [@host]; read_payload; } > "$f.tmp" && mv "$f.tmp" "$f.evt"
    let host = if dismiss { None } else { sys.find_host() };
    let payload = read_payload(&inv, sys);
    let contents = event::file_contents(&inv.agent, &inv.event, host.as_deref(), &payload);
    if fs::write(&tmp, contents).and_then(|()| fs::rename(&tmp, &evt)).is_err() {
        let _ = fs::remove_file(&tmp);
    }

    // if [ "$event" != "dismiss" ]; then pgrep -xq ClaudeBuddy || open ...; fi
    if !dismiss && !sys.app_running() {
        if let Some(exe) = read_app_path(&root) {
            sys.launch(&exe);
        }
    }
}

/// `read_payload`: the argument if there is one, else stdin (unless it is a console).
fn read_payload(inv: &cli::Invocation, sys: &mut dyn System) -> Vec<u8> {
    if !inv.payload.is_empty() {
        inv.payload.clone().into_bytes()
    } else {
        sys.read_stdin()
    }
}

/// `<home>\.claude-buddy\app-path`: the exe path the app wrote on its last launch.
fn read_app_path(root: &Path) -> Option<PathBuf> {
    let bytes = fs::read(root.join("app-path")).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let line = text.trim_start_matches('\u{feff}').lines().next()?.trim();
    (!line.is_empty()).then(|| PathBuf::from(line))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A fresh directory under the system temp dir, removed on drop.
    struct TempHome(PathBuf);

    impl TempHome {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir()
                .join(format!("buddy-notify-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&dir).unwrap();
            TempHome(dir)
        }
        fn root(&self) -> PathBuf {
            self.0.join(".claude-buddy")
        }
        fn inbox_files(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(self.root().join("inbox"))
                .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
                .unwrap_or_default();
            names.sort();
            names
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[derive(Default)]
    struct Fake {
        stdin: Vec<u8>,
        stdin_reads: u32,
        host: Option<String>,
        host_lookups: u32,
        running: bool,
        launched: Vec<PathBuf>,
    }

    impl System for Fake {
        fn read_stdin(&mut self) -> Vec<u8> {
            self.stdin_reads += 1;
            std::mem::take(&mut self.stdin)
        }
        fn find_host(&mut self) -> Option<String> {
            self.host_lookups += 1;
            self.host.clone()
        }
        fn app_running(&mut self) -> bool {
            self.running
        }
        fn launch(&mut self, exe: &Path) {
            self.launched.push(exe.to_path_buf());
        }
    }

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    const STOP_JSON: &str =
        r#"{"session_id":"s1","cwd":"C:\\Users\\me\\Work\\my-app","hook_event_name":"Stop"}"#;

    fn only_event(home: &TempHome) -> String {
        let files = home.inbox_files();
        assert_eq!(files.len(), 1, "files: {files:?}");
        assert_eq!(files[0], "1760000000-4242.evt");
        fs::read_to_string(home.root().join("inbox").join(&files[0])).unwrap()
    }

    #[test]
    fn done_with_stdin_payload_writes_header_host_and_payload() {
        let home = TempHome::new();
        let mut sys = Fake {
            stdin: STOP_JSON.as_bytes().to_vec(),
            host: Some(r"C:\Program Files\WindowsApps\Claude_1\app\Claude.exe".into()),
            running: true,
            ..Fake::default()
        };
        run(&args(&["claude", "done"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(
            only_event(&home),
            format!("claude done\n@host C:\\Program Files\\WindowsApps\\Claude_1\\app\\Claude.exe\n{STOP_JSON}")
        );
        assert!(sys.launched.is_empty(), "app is running, nothing to launch");
    }

    #[test]
    fn original_form_with_payload_argument_does_not_touch_stdin() {
        let home = TempHome::new();
        let mut sys = Fake { stdin: b"ignored".to_vec(), running: true, ..Fake::default() };
        run(&args(&["waiting", STOP_JSON]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(only_event(&home), format!("claude waiting\n{STOP_JSON}"));
        assert_eq!(sys.stdin_reads, 0);
    }

    #[test]
    fn codex_json_in_the_event_slot_becomes_event_auto() {
        let home = TempHome::new();
        let json = r#"{"type":"agent-turn-complete","cwd":"C:\\Users\\me\\Work\\my-app"}"#;
        let mut sys = Fake { running: true, ..Fake::default() };
        run(&args(&["codex", json]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(only_event(&home), format!("codex auto\n{json}"));
    }

    #[test]
    fn dismiss_without_active_marker_writes_nothing_but_drains_stdin() {
        let home = TempHome::new();
        let mut sys = Fake { stdin: STOP_JSON.as_bytes().to_vec(), ..Fake::default() };
        run(&args(&["claude", "dismiss"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert!(home.inbox_files().is_empty());
        assert!(!home.root().exists(), "the cheap path creates nothing");
        assert_eq!(sys.stdin_reads, 1);
        assert_eq!(sys.host_lookups, 0);
        assert!(sys.launched.is_empty());
    }

    #[test]
    fn dismiss_with_a_payload_argument_does_not_read_stdin() {
        let home = TempHome::new();
        let mut sys = Fake::default();
        run(&args(&["dismiss", "{}"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(sys.stdin_reads, 0);
    }

    #[test]
    fn dismiss_with_active_marker_writes_an_event_without_host_and_never_launches() {
        let home = TempHome::new();
        fs::create_dir_all(home.root()).unwrap();
        fs::write(home.root().join("active"), b"").unwrap();
        fs::write(home.root().join("app-path"), "C:\\x\\ClaudeBuddy.exe").unwrap();
        let mut sys = Fake {
            stdin: STOP_JSON.as_bytes().to_vec(),
            host: Some(r"C:\Claude.exe".into()),
            running: false,
            ..Fake::default()
        };
        run(&args(&["claude", "dismiss"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(only_event(&home), format!("claude dismiss\n{STOP_JSON}"));
        assert_eq!(sys.host_lookups, 0, "no @host for dismiss, so no lookup either");
        assert!(sys.launched.is_empty(), "dismiss never starts the app");
    }

    #[test]
    fn missing_host_means_no_host_line() {
        let home = TempHome::new();
        let mut sys = Fake { running: true, host: None, ..Fake::default() };
        run(&args(&["claude", "done", "{}"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(only_event(&home), "claude done\n{}");
    }

    #[test]
    fn app_not_running_is_launched_from_app_path() {
        let home = TempHome::new();
        fs::create_dir_all(home.root()).unwrap();
        // BOM + trailing CRLF, as a hand-edited file might have
        fs::write(home.root().join("app-path"), "\u{feff}C:\\Apps\\ClaudeBuddy\\ClaudeBuddy.exe\r\n").unwrap();
        let mut sys = Fake { running: false, ..Fake::default() };
        run(&args(&["claude", "done", "{}"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(sys.launched, vec![PathBuf::from(r"C:\Apps\ClaudeBuddy\ClaudeBuddy.exe")]);
        assert_eq!(home.inbox_files().len(), 1, "the event is written before the app starts");
    }

    #[test]
    fn app_not_running_and_no_app_path_launches_nothing() {
        let home = TempHome::new();
        let mut sys = Fake { running: false, ..Fake::default() };
        run(&args(&["claude", "done", "{}"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert!(sys.launched.is_empty());
        fs::write(home.root().join("app-path"), "  \r\n").unwrap();
        run(&args(&["claude", "done", "{}"]), &home.0, 1_760_000_001, 4242, &mut sys);
        assert!(sys.launched.is_empty(), "an empty app-path is ignored");
    }

    #[test]
    fn no_leftover_tmp_file_and_same_name_is_overwritten() {
        let home = TempHome::new();
        let mut sys = Fake { running: true, ..Fake::default() };
        run(&args(&["claude", "done", "{\"a\":1}"]), &home.0, 1_760_000_000, 4242, &mut sys);
        run(&args(&["claude", "done", "{\"a\":2}"]), &home.0, 1_760_000_000, 4242, &mut sys);
        assert_eq!(only_event(&home), "claude done\n{\"a\":2}");
    }

    #[test]
    fn unwritable_inbox_is_swallowed() {
        let home = TempHome::new();
        // a file where the .claude-buddy directory should be
        fs::write(home.root(), b"not a directory").unwrap();
        let mut sys = Fake { running: true, ..Fake::default() };
        run(&args(&["claude", "done", "{}"]), &home.0, 1_760_000_000, 4242, &mut sys);
    }

    #[test]
    fn home_prefers_buddy_home_then_user_profile() {
        use std::ffi::OsString;
        let os = |s: &str| Some(OsString::from(s));
        assert_eq!(home_dir(os(r"C:\tmp\h"), os(r"C:\Users\me")), Some(PathBuf::from(r"C:\tmp\h")));
        assert_eq!(home_dir(None, os(r"C:\Users\me")), Some(PathBuf::from(r"C:\Users\me")));
        assert_eq!(home_dir(os(""), os(r"C:\Users\me")), Some(PathBuf::from(r"C:\Users\me")));
        assert_eq!(home_dir(None, None), None);
    }
}
