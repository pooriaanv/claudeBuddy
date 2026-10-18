//! Platform split (02-architecture.md). Windows and macOS are implemented; Linux comes later.

#[cfg(windows)]
pub mod foreground;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;
