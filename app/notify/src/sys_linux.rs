//! The Linux implementation of `run::System`: `/proc` for the process chain, `isatty` for the stdin check, the same
//! file lock as macOS for "is the app running", and a detached spawn (own process group) for the launch.

use crate::host::{self, ProcessTable};
use crate::run::System;
use std::fs::{File, OpenOptions, TryLockError};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The app holds an exclusive lock on this file (in `.claude-buddy`) while it runs.
const RUNNING_LOCK: &str = "running.lock";

pub struct LinuxSystem {
    /// `~/.claude-buddy`
    pub root: PathBuf,
}

impl System for LinuxSystem {
    fn read_stdin(&mut self) -> Vec<u8> {
        if unsafe { libc::isatty(0) } == 1 {
            return Vec::new();
        }
        let mut bytes = Vec::new();
        let _ = std::io::stdin().lock().read_to_end(&mut bytes);
        bytes
    }

    fn find_host(&mut self) -> Option<String> {
        host::find_host(&Procs, std::process::id())
    }

    fn app_running(&mut self) -> bool {
        let Ok(file) = OpenOptions::new().create(true).truncate(false).write(true).open(self.root.join(RUNNING_LOCK))
        else {
            return false;
        };
        matches!(file.try_lock(), Err(TryLockError::WouldBlock))
    }

    /// The app (or its AppImage) in its own process group, so it outlives the hook and the agent's terminal.
    fn launch(&mut self, exe: &Path) {
        let _ = Command::new(exe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn();
    }
}

/// The live process table from `/proc`.
struct Procs;

/// `/proc/<pid>/stat` fields after the command name (which may contain spaces and parentheses).
fn stat_fields(pid: u32) -> Option<Vec<String>> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    Some(rest.split_whitespace().map(str::to_owned).collect())
}

impl ProcessTable for Procs {
    fn parent_pid(&self, pid: u32) -> Option<u32> {
        // After ")": state, ppid, ...
        stat_fields(pid)?.get(1)?.parse().ok()
    }

    fn exe_name(&self, pid: u32) -> Option<String> {
        let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
        Some(comm.trim_end().to_owned())
    }

    fn creation_time(&self, pid: u32) -> Option<u64> {
        // Field 22 of stat (starttime, clock ticks since boot) = index 19 after the ")".
        stat_fields(pid)?.get(19)?.parse().ok()
    }

    fn image_path(&self, pid: u32) -> Option<String> {
        let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
        Some(exe.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_live_table_reads_this_process() {
        let me = std::process::id();
        assert_eq!(Procs.parent_pid(me), Some(std::os::unix::process::parent_id()));
        assert!(Procs.creation_time(me).is_some());
        assert!(Procs.image_path(me).is_some_and(|p| p.starts_with('/')));
        assert!(Procs.exe_name(me).is_some_and(|n| !n.is_empty()));
    }

    #[test]
    fn lock_is_seen_only_while_held() {
        let dir = std::env::temp_dir().join(format!("buddy-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut sys = LinuxSystem { root: dir.clone() };
        assert!(!sys.app_running());
        let held = File::create(dir.join(RUNNING_LOCK)).unwrap();
        held.lock().unwrap();
        assert!(sys.app_running());
        drop(held);
        assert!(!sys.app_running());
        let _ = std::fs::remove_dir_all(dir);
    }
}
