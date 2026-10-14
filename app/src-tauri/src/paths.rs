//! `%USERPROFILE%\.claude-buddy\` and friends. Port of `BuddyPaths` (Preferences.swift) with the Windows
//! helper from 12-windows-plan.md D10.
//!
//! Everything hangs off a `BuddyPaths` value that holds the home directory, so tests (and the debug-only
//! `BUDDY_HOME` override) never need to touch the real profile.
// Wired into the app by the P4 integration step; until then only the tests call most of it.
#![allow(dead_code)]

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The app holds this named mutex while it runs; `buddy-notify.exe` opens it to decide whether to launch the
/// app (D10). `Local\` = the user's logon session.
pub const RUNNING_MUTEX_NAME: &str = "Local\\com.pooria.claudebuddy.running";

/// File name of the hook helper, in the app's resources and in `.claude-buddy`.
pub const HELPER_FILE_NAME: &str = "buddy-notify.exe";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuddyPaths {
    home: PathBuf,
}

impl BuddyPaths {
    /// For tests and tools: any directory acts as the home.
    pub fn new(home: impl Into<PathBuf>) -> Self {
        BuddyPaths { home: home.into() }
    }

    /// The real home: `BUDDY_HOME` when set (debug builds only), else `%USERPROFILE%`.
    pub fn current() -> Self {
        let buddy_home = if cfg!(debug_assertions) { std::env::var_os("BUDDY_HOME") } else { None };
        Self::new(resolve_home(buddy_home, std::env::var_os("USERPROFILE")))
    }

    pub fn home(&self) -> &Path {
        &self.home
    }

    /// `~/.claude-buddy`
    pub fn root(&self) -> PathBuf {
        self.home.join(".claude-buddy")
    }

    /// `~/.claude-buddy/inbox`: where `buddy-notify.exe` drops event files.
    pub fn inbox(&self) -> PathBuf {
        self.root().join("inbox")
    }

    /// Exists while the buddy is knocking; lets the helper skip "dismiss" events cheaply.
    pub fn active_marker(&self) -> PathBuf {
        self.root().join("active")
    }

    /// Holds the app's own exe path, written on every launch; the helper starts the app from it.
    pub fn app_path_file(&self) -> PathBuf {
        self.root().join("app-path")
    }

    /// `~/.claude-buddy/buddy-notify.exe`: what the hook commands point at.
    pub fn helper(&self) -> PathBuf {
        self.root().join(HELPER_FILE_NAME)
    }

    /// Port of `installNotifyScript`: copies the bundled helper into `.claude-buddy` unless the bytes already
    /// match. A running exe cannot be overwritten but can be renamed, so when the target is in use: old ->
    /// `.old`, new -> target, then delete `.old` (best effort; a leftover is removed on the next call).
    /// Returns `true` when the installed file changed.
    pub fn install_notify_helper(&self, bundled: &Path) -> io::Result<bool> {
        let data = fs::read(bundled)?;
        let target = self.helper();
        let old = with_suffix(&target, ".old");
        let _ = fs::remove_file(&old); // leftover of an earlier replace while the old exe was running

        if fs::read(&target).is_ok_and(|current| current == data) {
            return Ok(false);
        }
        fs::create_dir_all(self.root())?;

        let staged = with_suffix(&target, ".new");
        fs::write(&staged, &data)?;
        let installed = fs::rename(&staged, &target).or_else(|_| {
            // Replacing failed: most likely a hook is running the current exe right now.
            fs::rename(&target, &old).and_then(|()| {
                fs::rename(&staged, &target).inspect_err(|_| {
                    let _ = fs::rename(&old, &target); // put the old one back
                })
            })
        });
        if let Err(e) = installed {
            let _ = fs::remove_file(&staged);
            return Err(e);
        }
        let _ = fs::remove_file(&old);
        Ok(true)
    }

    /// Writes `exe` to `app-path` (only when it differs), so the helper can start the app later.
    pub fn write_app_path_for(&self, exe: &Path) -> io::Result<()> {
        let text = display_path(exe);
        if fs::read_to_string(self.app_path_file()).is_ok_and(|current| current == text) {
            return Ok(());
        }
        fs::create_dir_all(self.root())?;
        let staged = with_suffix(&self.app_path_file(), ".tmp");
        fs::write(&staged, &text)?;
        fs::rename(&staged, self.app_path_file()).inspect_err(|_| {
            let _ = fs::remove_file(&staged);
        })
    }

    /// `write_app_path_for(current_exe())`: call on every launch.
    pub fn write_app_path(&self) -> io::Result<()> {
        self.write_app_path_for(&std::env::current_exe()?)
    }

    /// Port of `setActive`.
    pub fn set_active(&self, on: bool) {
        if on {
            let _ = fs::create_dir_all(self.root());
            let _ = fs::write(self.active_marker(), b"");
        } else {
            let _ = fs::remove_file(self.active_marker());
        }
    }
}

/// `BUDDY_HOME` (if given and non-empty) wins over the user profile; with neither, the current directory (a
/// last resort that keeps the callers infallible).
fn resolve_home(buddy_home: Option<OsString>, user_profile: Option<OsString>) -> PathBuf {
    [buddy_home, user_profile]
        .into_iter()
        .flatten()
        .find(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// `buddy-notify.exe` + `.old` -> `buddy-notify.exe.old`
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// The path as the helper reads it back: no `\\?\` verbatim prefix (`current_exe` may return one).
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A fresh directory under the system temp dir, removed on drop.
    pub struct TempDir(PathBuf);

    impl TempDir {
        pub fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir()
                .join(format!("claudebuddy-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::TempDir;
    use super::*;

    fn paths(dir: &TempDir) -> BuddyPaths {
        BuddyPaths::new(dir.path())
    }

    #[test]
    fn layout_hangs_off_the_home_dir() {
        let p = BuddyPaths::new(r"C:\Users\me");
        assert_eq!(p.root(), PathBuf::from(r"C:\Users\me\.claude-buddy"));
        assert_eq!(p.inbox(), PathBuf::from(r"C:\Users\me\.claude-buddy\inbox"));
        assert_eq!(p.active_marker(), PathBuf::from(r"C:\Users\me\.claude-buddy\active"));
        assert_eq!(p.app_path_file(), PathBuf::from(r"C:\Users\me\.claude-buddy\app-path"));
        assert_eq!(p.helper(), PathBuf::from(r"C:\Users\me\.claude-buddy\buddy-notify.exe"));
    }

    #[test]
    fn buddy_home_overrides_the_profile_only_when_set() {
        let os = |s: &str| Some(OsString::from(s));
        assert_eq!(resolve_home(os(r"C:\tmp\h"), os(r"C:\Users\me")), PathBuf::from(r"C:\tmp\h"));
        assert_eq!(resolve_home(None, os(r"C:\Users\me")), PathBuf::from(r"C:\Users\me"));
        assert_eq!(resolve_home(os(""), os(r"C:\Users\me")), PathBuf::from(r"C:\Users\me"));
        assert_eq!(resolve_home(None, None), PathBuf::from("."));
    }

    #[test]
    fn active_marker_toggles() {
        let dir = TempDir::new();
        let p = paths(&dir);
        p.set_active(false); // nothing there: no error, no directory created
        assert!(!p.root().exists());
        p.set_active(true);
        assert!(p.active_marker().is_file());
        p.set_active(true); // idempotent
        p.set_active(false);
        assert!(!p.active_marker().exists());
    }

    #[test]
    fn app_path_is_written_once_and_without_verbatim_prefix() {
        let dir = TempDir::new();
        let p = paths(&dir);
        p.write_app_path_for(Path::new(r"\\?\C:\Apps\ClaudeBuddy\ClaudeBuddy.exe")).unwrap();
        assert_eq!(fs::read_to_string(p.app_path_file()).unwrap(), r"C:\Apps\ClaudeBuddy\ClaudeBuddy.exe");
        p.write_app_path_for(Path::new(r"C:\Other\ClaudeBuddy.exe")).unwrap();
        assert_eq!(fs::read_to_string(p.app_path_file()).unwrap(), r"C:\Other\ClaudeBuddy.exe");
        assert!(!with_suffix(&p.app_path_file(), ".tmp").exists());
    }

    #[test]
    fn helper_is_copied_then_left_alone_when_equal() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let bundled = dir.path().join("bundled.exe");
        fs::write(&bundled, b"v1").unwrap();

        assert!(p.install_notify_helper(&bundled).unwrap(), "first install copies");
        assert_eq!(fs::read(p.helper()).unwrap(), b"v1");
        assert!(!p.install_notify_helper(&bundled).unwrap(), "same bytes: untouched");

        fs::write(&bundled, b"v2").unwrap();
        assert!(p.install_notify_helper(&bundled).unwrap(), "different bytes: replaced");
        assert_eq!(fs::read(p.helper()).unwrap(), b"v2");
        let leftovers: Vec<_> = fs::read_dir(p.root()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers, vec![OsString::from("buddy-notify.exe")]);
    }

    #[test]
    fn missing_bundled_helper_is_an_error_and_changes_nothing() {
        let dir = TempDir::new();
        let p = paths(&dir);
        assert!(p.install_notify_helper(&dir.path().join("nope.exe")).is_err());
        assert!(!p.root().exists());
    }

    /// The case the rename dance exists for: the installed exe is running (a hook is in flight).
    #[test]
    fn helper_in_use_is_replaced_by_renaming() {
        use std::process::{Command, Stdio};
        let dir = TempDir::new();
        let p = paths(&dir);
        fs::create_dir_all(p.root()).unwrap();

        // A real, harmless, short-lived console exe stands in for the running helper.
        let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into()));
        fs::copy(system.join(r"System32\ping.exe"), p.helper()).unwrap();
        let mut running = Command::new(p.helper())
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        // Premise of this test: Windows really refuses to replace the image of a running process.
        let probe = with_suffix(&p.helper(), ".probe");
        fs::write(&probe, b"x").unwrap();
        assert!(fs::rename(&probe, p.helper()).is_err(), "a running exe must not be replaceable in place");
        fs::remove_file(&probe).unwrap();

        let bundled = dir.path().join("bundled.exe");
        fs::write(&bundled, b"new helper bytes").unwrap();
        let result = p.install_notify_helper(&bundled);

        let old = with_suffix(&p.helper(), ".old");
        let (replaced, old_left) = (fs::read(p.helper()).ok(), old.exists());
        running.kill().unwrap();
        running.wait().unwrap();

        assert!(result.unwrap(), "install reports a change");
        assert_eq!(replaced.as_deref(), Some(&b"new helper bytes"[..]));
        // While the old exe ran, it could not be deleted; once it exits, the next call cleans up.
        if old_left {
            p.install_notify_helper(&bundled).unwrap();
            assert!(!old.exists(), "leftover .old is removed by the next install call");
        }
    }
}
