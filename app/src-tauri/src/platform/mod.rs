//! Platform split (02-architecture.md). Only Windows is implemented for now; Linux comes later.

#[cfg(windows)]
pub mod foreground;
#[cfg(windows)]
pub mod windows;
