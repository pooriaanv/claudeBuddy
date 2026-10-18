//! The macOS implementation of `run::System` (notify.sh did the same with `ps`, `pgrep` and `open`):
//! `proc_pidinfo` for the process chain, `isatty` for the stdin check, a file lock for "is the app running",
//! `open -g` (or a detached spawn for a bare dev binary) for the launch.

use crate::host::{self, ProcessTable};
use crate::run::System;
use std::ffi::c_void;
use std::fs::{File, OpenOptions, TryLockError};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The app holds an exclusive lock on this file (in `.claude-buddy`) while it runs.
const RUNNING_LOCK: &str = "running.lock";

pub struct MacSystem {
    /// `~/.claude-buddy`
    pub root: PathBuf,
}

impl System for MacSystem {
    fn read_stdin(&mut self) -> Vec<u8> {
        // notify.sh: `elif [ ! -t 0 ]; then cat`.
        if unsafe { libc::isatty(0) } == 1 {
            return Vec::new();
        }
        let mut bytes = Vec::new();
        let _ = std::io::stdin().lock().read_to_end(&mut bytes);
        bytes
    }

    fn find_host(&mut self) -> Option<String> {
        bundle_of(&host::find_host(&Procs, std::process::id())?)
    }

    fn app_running(&mut self) -> bool {
        let Ok(file) = OpenOptions::new().create(true).truncate(false).write(true).open(self.root.join(RUNNING_LOCK))
        else {
            return false;
        };
        is_locked(&file)
    }

    fn launch(&mut self, exe: &Path) {
        match bundle_of(&exe.to_string_lossy()) {
            // notify.sh: `open -g -b com.pooria.claudebuddy` (in the background, through LaunchServices).
            Some(bundle) => {
                let _ = Command::new("/usr/bin/open").args(["-g", &bundle]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            }
            // A dev build outside a bundle: start it in its own process group so it outlives the hook.
            None => {
                let _ = Command::new(exe)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .process_group(0)
                    .spawn();
            }
        }
    }
}

/// Someone else holds the lock. Taking it ourselves means nobody does; it is released when `file` closes.
fn is_locked(file: &File) -> bool {
    matches!(file.try_lock(), Err(TryLockError::WouldBlock))
}

/// notify.sh: `${comm%%.app/*}.app` - the path up to the first `.app/`, or None outside a bundle.
pub fn bundle_of(path: &str) -> Option<String> {
    path.find(".app/").map(|i| path[..i + 4].to_string())
}

/// The live process table, read one pid at a time. Root processes (launchd, Terminal's `login`) are unreadable
/// and count as missing, which ends the walk right below them - for launchd that is notify.sh's "parent = 1"
/// rule; under `login` the host is a shell (no bundle), which is never a dedicated agent app anyway.
struct Procs;

fn bsd_info(pid: u32) -> Option<libc::proc_bsdinfo> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let n = unsafe {
        libc::proc_pidinfo(pid as i32, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut c_void, size)
    };
    (n == size).then_some(info)
}

impl ProcessTable for Procs {
    fn parent_pid(&self, pid: u32) -> Option<u32> {
        bsd_info(pid).map(|i| i.pbi_ppid)
    }

    fn exe_name(&self, pid: u32) -> Option<String> {
        let info = bsd_info(pid)?;
        let comm: Vec<u8> = info.pbi_comm.iter().take_while(|&&c| c != 0).map(|&c| c as u8).collect();
        Some(String::from_utf8_lossy(&comm).into_owned())
    }

    fn creation_time(&self, pid: u32) -> Option<u64> {
        bsd_info(pid).map(|i| i.pbi_start_tvsec * 1_000_000 + i.pbi_start_tvusec)
    }

    fn image_path(&self, pid: u32) -> Option<String> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let n = unsafe { libc::proc_pidpath(pid as i32, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
        (n > 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_is_the_path_up_to_the_first_app() {
        assert_eq!(bundle_of("/Applications/Claude.app/Contents/MacOS/Claude").as_deref(), Some("/Applications/Claude.app"));
        assert_eq!(
            bundle_of("/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper").as_deref(),
            Some("/Applications/Claude.app")
        );
        assert_eq!(bundle_of("/usr/local/bin/claude"), None);
    }

    #[test]
    fn the_live_table_walks_to_a_real_ancestor() {
        // The test runner's own chain ends below launchd; whatever it is, its path must be readable.
        let me = std::process::id();
        assert!(Procs.parent_pid(me).is_some());
        assert!(Procs.creation_time(me).is_some());
        assert!(Procs.image_path(me).is_some_and(|p| p.starts_with('/')));
        assert_eq!(Procs.parent_pid(me), Some(std::os::unix::process::parent_id()));
        assert!(Procs.exe_name(1).is_none_or(|n| n == "launchd"));
    }

    #[test]
    fn lock_is_seen_only_while_held() {
        let dir = std::env::temp_dir().join(format!("buddy-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut sys = MacSystem { root: dir.clone() };
        assert!(!sys.app_running());
        let held = File::create(dir.join(RUNNING_LOCK)).unwrap();
        held.lock().unwrap();
        assert!(sys.app_running());
        drop(held);
        assert!(!sys.app_running());
        let _ = std::fs::remove_dir_all(dir);
    }
}
