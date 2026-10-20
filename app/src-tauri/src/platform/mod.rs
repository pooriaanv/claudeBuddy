//! Platform split (02-architecture.md). Windows, macOS and Linux (X11 / XWayland).

#[cfg(windows)]
pub mod foreground;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;
