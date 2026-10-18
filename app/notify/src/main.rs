//! buddy-notify: the hook helper of ClaudeBuddy on Windows (12-windows-plan.md D10, port of scripts/notify.sh).
//!
//! `buddy-notify <agent> <event> [json]` drops an event file into `<home>\.claude-buddy\inbox` and starts the
//! app if it is not running. Prints nothing and always exits 0 (a hook must never break the agent).
//!
//! Home is `%USERPROFILE%` (`$HOME` on macOS), or the `BUDDY_HOME` environment variable when set (tests and
//! debugging).

mod cli;
mod event;
mod host;
mod run;
#[cfg(windows)]
mod sys;
#[cfg(target_os = "macos")]
mod sys_macos;

fn main() {
    // A panic must not change the exit code or print anything (Claude shows a hook's stderr).
    std::panic::set_hook(Box::new(|_| {}));
    let _ = std::panic::catch_unwind(real_main);
}

#[cfg(windows)]
fn real_main() {
    let args: Vec<String> = std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    let Some(home) = run::home_dir(std::env::var_os("BUDDY_HOME"), std::env::var_os("USERPROFILE")) else {
        return;
    };
    let unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    run::run(&args, &home, unix_secs, std::process::id(), &mut sys::WinSystem);
}

#[cfg(target_os = "macos")]
fn real_main() {
    let args: Vec<String> = std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    let Some(home) = run::home_dir(std::env::var_os("BUDDY_HOME"), std::env::var_os("HOME")) else {
        return;
    };
    let unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut sys = sys_macos::MacSystem { root: home.join(".claude-buddy") };
    run::run(&args, &home, unix_secs, std::process::id(), &mut sys);
}

#[cfg(not(any(windows, target_os = "macos")))]
fn real_main() {}
