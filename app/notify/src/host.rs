//! The GUI app a session runs in (Claude desktop, Windows Terminal, VS Code...): the topmost ancestor of this
//! process. Port of `notify.sh host_app` ("the topmost .app among our ancestors") with the Windows rule from
//! 05-windows.md "Host app detection".

/// Processes that end the walk: they start user programs but are never the app the user is working in.
const STOP_LIST: [&str; 5] = ["explorer.exe", "svchost.exe", "services.exe", "sihost.exe", "wininit.exe"];

/// macOS: launchd (pid 1) starts every app; the host is the ancestor right below it (notify.sh: "parent = 1").
const MAC_STOP_LIST: [&str; 1] = ["launchd"];

/// Linux: systemd (pid 1, and the per-user manager that starts desktop apps) and init.
const LINUX_STOP_LIST: [&str; 2] = ["systemd", "init"];

/// Safety net against odd tables (a cycle of equal creation times); real chains are < 10 deep.
const MAX_DEPTH: usize = 64;

/// What the walk needs to know about running processes. The real implementation is a Toolhelp snapshot plus
/// `OpenProcess`; tests use a hand-made table.
pub trait ProcessTable {
    /// Parent pid recorded for `pid`; `None` when `pid` is not in the table.
    fn parent_pid(&self, pid: u32) -> Option<u32>;
    /// Image file name of `pid` (`explorer.exe`); `None` when `pid` is not in the table.
    fn exe_name(&self, pid: u32) -> Option<String>;
    /// Creation time (FILETIME ticks, only compared); `None` when it cannot be read.
    fn creation_time(&self, pid: u32) -> Option<u64>;
    /// Full image path; `None` when it cannot be read (e.g. an elevated process).
    fn image_path(&self, pid: u32) -> Option<String>;
}

/// Full exe path of the topmost ancestor of `own_pid`, or `None` (helper started directly by Explorer, a service,
/// a missing or reused parent, an unreadable path). Mac: `pid=$PPID; while parent != 1 ...`.
pub fn find_host(table: &impl ProcessTable, own_pid: u32) -> Option<String> {
    let mut child = own_pid;
    let mut host = None;
    for _ in 0..MAX_DEPTH {
        let Some(parent) = table.parent_pid(child) else { break };
        if !is_host_candidate(table, parent, child) {
            break;
        }
        host = Some(parent);
        child = parent;
    }
    table.image_path(host?)
}

/// May `parent` (the recorded parent of `child`) be part of the chain?
fn is_host_candidate(table: &impl ProcessTable, parent: u32, child: u32) -> bool {
    // pid 0 = System Idle Process, 4 = System
    if parent == 0 || parent == 4 {
        return false;
    }
    // Missing: the parent has exited (the child outlived it, e.g. a detached launch).
    let Some(name) = table.exe_name(parent) else { return false };
    if STOP_LIST.iter().chain(&MAC_STOP_LIST).chain(&LINUX_STOP_LIST).any(|stop| stop.eq_ignore_ascii_case(&name)) {
        return false;
    }
    // Windows reuses pids: a "parent" created after its child is a stranger that got the old parent's pid.
    // If either time cannot be read we cannot tell, so the link is kept.
    if let (Some(parent_time), Some(child_time)) = (table.creation_time(parent), table.creation_time(child)) {
        if parent_time > child_time {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Proc {
        parent: u32,
        name: &'static str,
        created: Option<u64>,
        path: Option<&'static str>,
    }

    #[derive(Default)]
    struct FakeTable(HashMap<u32, Proc>);

    impl FakeTable {
        fn add(mut self, pid: u32, parent: u32, name: &'static str, created: u64, path: &'static str) -> Self {
            self.0.insert(pid, Proc { parent, name, created: Some(created), path: Some(path) });
            self
        }
    }

    impl ProcessTable for FakeTable {
        fn parent_pid(&self, pid: u32) -> Option<u32> {
            self.0.get(&pid).map(|p| p.parent)
        }
        fn exe_name(&self, pid: u32) -> Option<String> {
            self.0.get(&pid).map(|p| p.name.to_string())
        }
        fn creation_time(&self, pid: u32) -> Option<u64> {
            self.0.get(&pid).and_then(|p| p.created)
        }
        fn image_path(&self, pid: u32) -> Option<String> {
            self.0.get(&pid).and_then(|p| p.path.map(str::to_string))
        }
    }

    const CLAUDE_DESKTOP: &str = r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64__abc\app\Claude.exe";

    /// The verified chain of a Claude desktop session (05-windows.md), with fake pids.
    fn claude_desktop_chain() -> FakeTable {
        FakeTable::default()
            .add(600, 1, "explorer.exe", 10, r"C:\Windows\explorer.exe")
            .add(500, 600, "Claude.exe", 20, CLAUDE_DESKTOP)
            .add(400, 500, "claude.exe", 30, r"C:\Users\me\AppData\Roaming\Claude\claude-code\2.1.295\h\claude.exe")
            .add(300, 400, "bash.exe", 40, r"C:\Program Files\Git\bin\bash.exe")
            .add(200, 300, "bash.exe", 50, r"C:\Program Files\Git\usr\bin\bash.exe")
            .add(100, 200, "buddy-notify.exe", 60, r"C:\Users\me\.claude-buddy\buddy-notify.exe")
    }

    #[test]
    fn claude_desktop_session_resolves_to_the_desktop_exe() {
        assert_eq!(find_host(&claude_desktop_chain(), 100).as_deref(), Some(CLAUDE_DESKTOP));
    }

    #[test]
    fn windows_terminal_session_resolves_to_windows_terminal() {
        let wt = r"C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.0_x64__x\WindowsTerminal.exe";
        let table = FakeTable::default()
            .add(600, 1, "explorer.exe", 10, r"C:\Windows\explorer.exe")
            .add(500, 600, "WindowsTerminal.exe", 20, wt)
            .add(450, 500, "OpenConsole.exe", 21, r"C:\x\OpenConsole.exe")
            .add(400, 450, "pwsh.exe", 30, r"C:\Program Files\PowerShell\7\pwsh.exe")
            .add(300, 400, "claude.exe", 40, r"C:\Users\me\.local\bin\claude.exe")
            .add(100, 300, "buddy-notify.exe", 60, r"C:\Users\me\.claude-buddy\buddy-notify.exe");
        assert_eq!(find_host(&table, 100).as_deref(), Some(wt));
    }

    #[test]
    fn every_stop_list_name_ends_the_walk_case_insensitively() {
        let code = r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe";
        for stop in ["Explorer.EXE", "svchost.exe", "SERVICES.exe", "sihost.exe", "wininit.exe"] {
            let table = FakeTable::default()
                .add(300, 1, stop, 10, r"C:\Windows\System32\stop.exe")
                .add(200, 300, "Code.exe", 20, code)
                .add(100, 200, "buddy-notify.exe", 30, r"C:\h\buddy-notify.exe");
            assert_eq!(find_host(&table, 100).as_deref(), Some(code), "stop = {stop}");
        }
    }

    #[test]
    fn helper_started_directly_by_explorer_has_no_host() {
        let table = FakeTable::default()
            .add(600, 1, "explorer.exe", 10, r"C:\Windows\explorer.exe")
            .add(100, 600, "buddy-notify.exe", 30, r"C:\h\buddy-notify.exe");
        assert_eq!(find_host(&table, 100), None);
    }

    #[test]
    fn pid_zero_and_four_end_the_walk() {
        for system_pid in [0, 4] {
            let table = FakeTable::default()
                .add(system_pid, 0, "System", 1, r"C:\Windows\System32\ntoskrnl.exe")
                .add(200, system_pid, "svc.exe", 10, r"C:\svc.exe")
                .add(100, 200, "buddy-notify.exe", 30, r"C:\h\buddy-notify.exe");
            assert_eq!(find_host(&table, 100).as_deref(), Some(r"C:\svc.exe"));
        }
    }

    #[test]
    fn missing_parent_ends_the_walk_at_the_last_process_found() {
        // The agent exited; its recorded parent pid (999) is not running any more.
        let table = FakeTable::default()
            .add(200, 999, "claude.exe", 10, r"C:\Users\me\.local\bin\claude.exe")
            .add(100, 200, "buddy-notify.exe", 30, r"C:\h\buddy-notify.exe");
        assert_eq!(find_host(&table, 100).as_deref(), Some(r"C:\Users\me\.local\bin\claude.exe"));
    }

    #[test]
    fn missing_direct_parent_has_no_host() {
        let table = FakeTable::default().add(100, 999, "buddy-notify.exe", 30, r"C:\h\buddy-notify.exe");
        assert_eq!(find_host(&table, 100), None);
        // and an own pid that is not even in the table
        assert_eq!(find_host(&FakeTable::default(), 100), None);
    }

    #[test]
    fn reused_pid_is_not_followed() {
        // Claude.exe (500) died long ago and its pid was handed to an unrelated process created AFTER the
        // CLI (400) it used to parent. The walk must stop at the CLI, not report the stranger as the host.
        let table = FakeTable::default()
            .add(600, 1, "explorer.exe", 10, r"C:\Windows\explorer.exe")
            .add(500, 600, "notepad.exe", 35, r"C:\Windows\notepad.exe") // created at 35 > child's 30
            .add(400, 500, "claude.exe", 30, r"C:\Users\me\.local\bin\claude.exe")
            .add(100, 400, "buddy-notify.exe", 60, r"C:\h\buddy-notify.exe");
        assert_eq!(find_host(&table, 100).as_deref(), Some(r"C:\Users\me\.local\bin\claude.exe"));
    }

    #[test]
    fn reused_pid_directly_above_the_helper_means_no_host() {
        let table = FakeTable::default()
            .add(500, 600, "notepad.exe", 70, r"C:\Windows\notepad.exe") // created after the helper (60)
            .add(100, 500, "buddy-notify.exe", 60, r"C:\h\buddy-notify.exe");
        assert_eq!(find_host(&table, 100), None);
    }

    #[test]
    fn equal_creation_times_are_not_a_reuse() {
        let table = FakeTable::default()
            .add(200, 1, "tool.exe", 50, r"C:\tool.exe")
            .add(100, 200, "buddy-notify.exe", 50, r"C:\h\buddy-notify.exe");
        assert_eq!(find_host(&table, 100).as_deref(), Some(r"C:\tool.exe"));
    }

    #[test]
    fn unreadable_creation_time_keeps_the_link() {
        let mut table = claude_desktop_chain();
        table.0.get_mut(&500).unwrap().created = None;
        assert_eq!(find_host(&table, 100).as_deref(), Some(CLAUDE_DESKTOP));
    }

    #[test]
    fn unreadable_host_path_means_no_host_line() {
        let mut table = claude_desktop_chain();
        table.0.get_mut(&500).unwrap().path = None;
        assert_eq!(find_host(&table, 100), None);
    }

    #[test]
    fn a_cycle_terminates() {
        let table = FakeTable::default()
            .add(200, 100, "a.exe", 50, r"C:\a.exe")
            .add(100, 200, "b.exe", 50, r"C:\b.exe");
        assert!(find_host(&table, 100).is_some());
    }
}
