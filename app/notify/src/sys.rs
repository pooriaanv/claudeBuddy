//! The Windows implementation of `run::System`: Toolhelp snapshot for the process chain, `GetFileType` for the
//! stdin check, a named mutex for "is the app running", `CreateProcessW` for the launch.

use crate::host::{self, ProcessTable};
use crate::run::System;
use std::collections::HashMap;
use std::io::Read;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, FILETIME, HANDLE};
use windows::Win32::Storage::FileSystem::{FILE_TYPE_CHAR, GetFileType};
use windows::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, CreateProcessW, DETACHED_PROCESS, GetProcessTimes,
    OpenMutexW, OpenProcess, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW, STARTUPINFOW, SYNCHRONIZATION_SYNCHRONIZE,
};
use windows::core::{HRESULT, PCWSTR, PWSTR, w};

/// The app holds this named mutex while it runs (12-windows-plan.md D10). `Local\` = this logon session.
const RUNNING_MUTEX: PCWSTR = w!("Local\\com.pooria.claudebuddy.running");

pub struct WinSystem;

impl System for WinSystem {
    fn read_stdin(&mut self) -> Vec<u8> {
        // notify.sh: `elif [ ! -t 0 ]; then cat`. A console stdin would block on the keyboard.
        if stdin_is_console() {
            return Vec::new();
        }
        let mut bytes = Vec::new();
        let _ = std::io::stdin().lock().read_to_end(&mut bytes);
        bytes
    }

    fn find_host(&mut self) -> Option<String> {
        let table = Snapshot::take()?;
        host::find_host(&table, std::process::id())
    }

    fn app_running(&mut self) -> bool {
        mutex_exists(RUNNING_MUTEX)
    }

    fn launch(&mut self, exe: &Path) {
        let app: Vec<u16> = exe.as_os_str().encode_wide().chain([0]).collect();
        let dir: Option<Vec<u16>> = exe.parent().filter(|d| !d.as_os_str().is_empty()).map(|d| {
            d.as_os_str().encode_wide().chain([0]).collect()
        });
        let detached = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // The app must outlive the agent's process tree: leave its job object if the job allows it, else
        // start it inside the job (the plan says to verify this in P4).
        for flags in [detached | CREATE_BREAKAWAY_FROM_JOB, detached] {
            if create_process(&app, dir.as_deref(), flags) {
                return;
            }
        }
    }
}

/// Does a mutex with this name exist in the current session?
fn mutex_exists(name: PCWSTR) -> bool {
    // SAFETY: plain Win32 call with a NUL-terminated name; the handle is closed right away.
    unsafe {
        match OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, name) {
            Ok(handle) => {
                let _ = CloseHandle(handle);
                true
            }
            // Exists but belongs to something we may not open: still "running".
            Err(e) => e.code() == HRESULT::from_win32(ERROR_ACCESS_DENIED.0),
        }
    }
}

fn create_process(app: &[u16], dir: Option<&[u16]>, flags: PROCESS_CREATION_FLAGS) -> bool {
    // Command line = the quoted path; CreateProcessW may write into it, so it needs its own mutable buffer.
    let mut command_line: Vec<u16> = std::iter::once(b'"' as u16)
        .chain(app[..app.len() - 1].iter().copied())
        .chain([b'"' as u16, 0])
        .collect();
    let startup = STARTUPINFOW { cb: size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    let mut info = PROCESS_INFORMATION::default();
    // SAFETY: `app`, `command_line` and `dir` are NUL-terminated and outlive the call; handles are not
    // inherited (bInheritHandles = false), so the app never holds the hook's stdout/stderr pipes open.
    unsafe {
        let created = CreateProcessW(
            PCWSTR(app.as_ptr()),
            Some(PWSTR(command_line.as_mut_ptr())),
            None,
            None,
            false,
            flags,
            None,
            dir.map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr())),
            &startup,
            &mut info,
        );
        if created.is_err() {
            return false;
        }
        let _ = CloseHandle(info.hProcess);
        let _ = CloseHandle(info.hThread);
    }
    true
}

/// `GetFileType(stdin) == FILE_TYPE_CHAR`: a console (or the NUL device). A missing stdin counts as "not a
/// console" and then simply reads nothing.
fn stdin_is_console() -> bool {
    // SAFETY: GetStdHandle/GetFileType only inspect the handle.
    unsafe {
        match GetStdHandle(STD_INPUT_HANDLE) {
            Ok(handle) if !handle.is_invalid() => GetFileType(handle) == FILE_TYPE_CHAR,
            _ => false,
        }
    }
}

/// Owned process handle.
struct Process(HANDLE);

impl Process {
    fn open(pid: u32) -> Option<Process> {
        // SAFETY: OpenProcess has no preconditions; a failure (exited, protected) is just None.
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok().map(Process) }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        // SAFETY: the handle came from OpenProcess and is closed exactly once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// A Toolhelp snapshot of all processes (pid -> parent pid and image file name), plus on-demand queries.
struct Snapshot {
    entries: HashMap<u32, (u32, String)>,
}

impl Snapshot {
    fn take() -> Option<Snapshot> {
        let mut entries = HashMap::new();
        // SAFETY: the snapshot handle is closed before returning; `entry.dwSize` is set as the API requires.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                    entries.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        Some(Snapshot { entries })
    }
}

impl ProcessTable for Snapshot {
    fn parent_pid(&self, pid: u32) -> Option<u32> {
        self.entries.get(&pid).map(|(parent, _)| *parent)
    }

    fn exe_name(&self, pid: u32) -> Option<String> {
        self.entries.get(&pid).map(|(_, name)| name.clone())
    }

    fn creation_time(&self, pid: u32) -> Option<u64> {
        let process = Process::open(pid)?;
        let (mut created, mut exited, mut kernel, mut user) =
            (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        // SAFETY: the handle is valid and the four out-pointers point to live FILETIMEs.
        unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user).ok()? };
        Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
    }

    fn image_path(&self, pid: u32) -> Option<String> {
        let process = Process::open(pid)?;
        let mut buffer = vec![0u16; 32_768]; // the longest path Windows allows
        let mut len = buffer.len() as u32;
        // SAFETY: `buffer` holds `len` UTF-16 units; on success `len` is the number written (without the NUL).
        unsafe {
            QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len).ok()?;
        }
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Threading::CreateMutexW;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain([0]).collect()
    }

    #[test]
    fn mutex_check_sees_a_held_named_mutex_and_only_that() {
        let name = wide(&format!(r"Local\buddy-notify-test-{}", std::process::id()));
        assert!(!mutex_exists(PCWSTR(name.as_ptr())));
        // SAFETY: valid NUL-terminated name; the handle is closed below.
        let handle = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) }.unwrap();
        assert!(mutex_exists(PCWSTR(name.as_ptr())));
        unsafe { CloseHandle(handle).unwrap() };
        assert!(!mutex_exists(PCWSTR(name.as_ptr())));
    }

    #[test]
    fn the_real_mutex_name_is_a_well_formed_call() {
        // Whether the app is running is not asserted, only that the call is accepted.
        let _ = mutex_exists(RUNNING_MUTEX);
    }

    /// `CreateProcessW` with the argument layout `launch` uses really starts a process (a harmless one that exits
    /// at once). Breakaway may be refused when the test runner itself sits in a job, which is why `launch` retries.
    #[test]
    fn create_process_starts_a_detached_process() {
        let system = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let exe = wide(&format!(r"{system}\System32\whoami.exe"));
        let dir = wide(&format!(r"{system}\System32"));
        let detached = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        assert!(create_process(&exe, Some(&dir), detached));
        assert!(create_process(&exe, None, detached), "the working directory is optional");
        let _maybe_refused = create_process(&exe, Some(&dir), detached | CREATE_BREAKAWAY_FROM_JOB);
    }
}
