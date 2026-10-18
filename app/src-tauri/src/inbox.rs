//! The folder `buddy-notify.exe` drops event files into. Port of `InboxDirectory` (BuddyCore/Inbox.swift).
//! Parsing the text is done on the TypeScript side (`core/inbox.ts`); this module only moves files.
// Wired into the app by the P4 integration step (the 0.4 s drain thread, the startup clean).
#![allow(dead_code)]

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Port of `InboxDirectory.drain`: reads and deletes all pending events, oldest first.
///
/// Only `*.evt` files count (the helper writes `*.tmp` and renames when complete); order is by file name
/// (`<unix-seconds>-<pid>`); the text is decoded as UTF-8, lossy.
///
/// Deviation from the Swift code, which would hand back "" for a file it could not read and delete it
/// anyway: a file that cannot be read or deleted right now (for example an antivirus scan holds it on
/// Windows) is left in place and picked up by the next drain, so no event is lost or delivered twice.
pub fn drain(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "evt"))
        .collect();
    files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut texts = Vec::with_capacity(files.len());
    for file in files {
        let Ok(bytes) = fs::read(&file) else { continue };
        if fs::remove_file(&file).is_err() {
            continue;
        }
        texts.push(String::from_utf8_lossy(&bytes).into_owned());
    }
    texts
}

/// Port of `InboxDirectory.clean`: drops stale files (for example events written while the app was not
/// running), by modification time. Applies to every file in the folder, `.tmp` leftovers included.
pub fn clean(dir: &Path, older_than_secs: u64) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let limit = Duration::from_secs(older_than_secs);
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Swift: a file without a modification date counts as `.distantPast`, i.e. stale.
        let stale = match entry.metadata().and_then(|m| m.modified()) {
            Ok(modified) => now.duration_since(modified).is_ok_and(|age| age > limit),
            Err(_) => true,
        };
        if stale {
            let _ = fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::test_support::TempDir;
    use std::fs::File;

    fn write(dir: &Path, name: &str, content: &[u8]) {
        fs::write(dir.join(name), content).unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> =
            fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn drain_returns_evt_files_in_name_order_and_deletes_them() {
        let dir = TempDir::new();
        write(dir.path(), "1760000002-10.evt", b"claude done\n{}");
        write(dir.path(), "1760000001-77.evt", b"claude waiting\n");
        write(dir.path(), "1760000003-5.tmp", b"still being written");
        write(dir.path(), "notes.txt", b"not an event");

        let texts = drain(dir.path());
        assert_eq!(texts, vec!["claude waiting\n".to_string(), "claude done\n{}".to_string()]);
        assert_eq!(names(dir.path()), vec!["1760000003-5.tmp", "notes.txt"]);
        assert!(drain(dir.path()).is_empty(), "drained files are gone");
    }

    #[test]
    fn drain_sorts_by_file_name_like_the_swift_code() {
        let dir = TempDir::new();
        // string order, not numeric: "…-10" sorts before "…-9" exactly as `lastPathComponent <` does
        write(dir.path(), "1760000000-9.evt", b"b");
        write(dir.path(), "1760000000-10.evt", b"a");
        assert_eq!(drain(dir.path()), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn drain_decodes_utf8_lossily() {
        let dir = TempDir::new();
        write(dir.path(), "1-1.evt", "claude done\n{\"project\":\"پروژه\"}".as_bytes());
        write(dir.path(), "2-1.evt", b"claude done\n\xFF\xFE");
        let texts = drain(dir.path());
        assert_eq!(texts[0], "claude done\n{\"project\":\"پروژه\"}");
        assert_eq!(texts[1], "claude done\n\u{FFFD}\u{FFFD}");
    }

    #[test]
    fn drain_of_missing_or_empty_dir_is_empty() {
        let dir = TempDir::new();
        assert!(drain(&dir.path().join("nope")).is_empty());
        assert!(drain(dir.path()).is_empty());
    }

    // Share-mode locks exist on Windows only.
    #[cfg(windows)]
    #[test]
    fn drain_leaves_a_locked_file_for_the_next_round() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TempDir::new();
        write(dir.path(), "1-1.evt", b"claude done\n");
        write(dir.path(), "2-1.evt", b"claude waiting\n");
        // Open without FILE_SHARE_DELETE: reading works, deleting does not (a scanner holding the file).
        let held = fs::OpenOptions::new().read(true).share_mode(1).open(dir.path().join("1-1.evt")).unwrap();
        assert_eq!(drain(dir.path()), vec!["claude waiting\n".to_string()]);
        drop(held);
        assert_eq!(drain(dir.path()), vec!["claude done\n".to_string()]);
    }

    fn set_age(dir: &Path, name: &str, age_secs: u64) {
        let file = File::options().write(true).open(dir.join(name)).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(age_secs)).unwrap();
    }

    #[test]
    fn clean_removes_only_files_older_than_the_limit_of_any_kind() {
        let dir = TempDir::new();
        write(dir.path(), "old.evt", b"x");
        write(dir.path(), "old.tmp", b"x");
        write(dir.path(), "fresh.evt", b"x");
        write(dir.path(), "borderline.evt", b"x");
        set_age(dir.path(), "old.evt", 60);
        set_age(dir.path(), "old.tmp", 3600);
        set_age(dir.path(), "borderline.evt", 10);
        clean(dir.path(), 15);
        assert_eq!(names(dir.path()), vec!["borderline.evt", "fresh.evt"]);
    }

    #[test]
    fn clean_ignores_subdirectories_and_missing_dirs() {
        let dir = TempDir::new();
        fs::create_dir(dir.path().join("sub")).unwrap();
        clean(dir.path(), 0);
        assert_eq!(names(dir.path()), vec!["sub"]);
        clean(&dir.path().join("nope"), 0); // no panic
    }
}
