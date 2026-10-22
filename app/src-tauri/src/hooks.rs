//! Connects ClaudeBuddy to Claude Code and Codex by editing their hook configs. Port of `AgentIntegration`
//! (Sources/ClaudeBuddy/Integrations.swift) with the Windows decisions of 12-windows-plan.md D11.
//!
//! Both tools use the same JSON shape:
//! `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type": "command", "command": "..."}]}]}}`.
//!
//! The functions take a `BuddyPaths`, which holds the home directory, so tests run against a temp home and
//! never touch the real `~/.claude/settings.json`.
// Wired into the app (Tauri commands) by the P4 integration step.
#![allow(dead_code)]

use crate::paths::BuddyPaths;
use serde_json::{Map, Value, json};
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// An AI coding tool the buddy can hook into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentIntegration {
    Claude,
    Codex,
    /// Windows addition (Pooria, 2026-10-22): Cursor's agent hooks (`~/.cursor/hooks.json`, flat entries).
    Cursor,
}

/// One hook to install: (hook event, helper argument, matcher). Port of the `hooks` tuple array.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HookSpec {
    pub event: &'static str,
    pub arg: &'static str,
    pub matcher: Option<&'static str>,
}

const fn spec(event: &'static str, arg: &'static str, matcher: Option<&'static str>) -> HookSpec {
    HookSpec { event, arg, matcher }
}

/// Windows addition (Pooria, 2026-10-15): `PermissionRequest`. In the Claude desktop app the permission prompt is shown
/// by the app, so `Notification` never fires for it; the Codex spec already uses this event.
const CLAUDE_HOOKS: [HookSpec; 5] = [
    spec("Stop", "done", None),
    spec("Notification", "waiting", None),
    spec("PermissionRequest", "permission", Some("*")),
    spec("UserPromptSubmit", "dismiss", None),
    spec("PostToolUse", "dismiss", Some("*")),
];

/// Cursor has no hook for "waiting for your OK" (its approvals stay in its own UI), so only done and dismiss.
const CURSOR_HOOKS: [HookSpec; 3] = [
    spec("stop", "done", None),
    spec("beforeSubmitPrompt", "dismiss", None),
    spec("postToolUse", "dismiss", None),
];

const CODEX_HOOKS: [HookSpec; 4] = [
    spec("Stop", "done", None),
    spec("PermissionRequest", "permission", Some("*")),
    spec("UserPromptSubmit", "dismiss", None),
    spec("PostToolUse", "dismiss", Some("*")),
];

impl AgentIntegration {
    pub const ALL: [AgentIntegration; 3] = [AgentIntegration::Claude, AgentIntegration::Codex, AgentIntegration::Cursor];

    /// The agent name the helper is called with (`rawValue`).
    pub fn raw_value(self) -> &'static str {
        match self {
            AgentIntegration::Claude => "claude",
            AgentIntegration::Codex => "codex",
            AgentIntegration::Cursor => "cursor",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            AgentIntegration::Claude => "Claude Code",
            AgentIntegration::Codex => "Codex",
            AgentIntegration::Cursor => "Cursor",
        }
    }

    /// `configURL`: `.claude\settings.json` / `.codex\hooks.json` under the home directory.
    pub fn config_path(self, home: &Path) -> PathBuf {
        match self {
            AgentIntegration::Claude => home.join(".claude").join("settings.json"),
            AgentIntegration::Codex => home.join(".codex").join("hooks.json"),
            AgentIntegration::Cursor => home.join(".cursor").join("hooks.json"),
        }
    }

    pub fn hook_specs(self) -> &'static [HookSpec] {
        match self {
            AgentIntegration::Claude => &CLAUDE_HOOKS,
            AgentIntegration::Codex => &CODEX_HOOKS,
            AgentIntegration::Cursor => &CURSOR_HOOKS,
        }
    }

    /// The hook command for `arg`: `C:/Users/me/.claude-buddy/buddy-notify.exe claude done`.
    pub fn command(self, helper: &Path, arg: &str) -> String {
        format_command(helper, self.raw_value(), arg)
    }

    /// `toolDetected`: Claude -> `.claude` exists; Codex -> `.codex` exists or `codex.exe` / `codex.cmd` is on PATH
    /// (`codex` on macOS).
    pub fn tool_detected(self, home: &Path) -> bool {
        #[cfg(windows)]
        const CODEX_NAMES: &[&str] = &["codex.exe", "codex.cmd"];
        #[cfg(not(windows))]
        const CODEX_NAMES: &[&str] = &["codex"];
        match self {
            AgentIntegration::Claude => home.join(".claude").exists(),
            AgentIntegration::Codex => home.join(".codex").exists() || on_path(std::env::var_os("PATH"), CODEX_NAMES),
            AgentIntegration::Cursor => home.join(".cursor").exists(),
        }
    }

    // MARK: install / uninstall

    /// `isConnected`: every hook spec has a buddy handler (command contains `buddy-notify` and ends with
    /// `" <agent> <arg>"`, with or without a closing quote before the space). Unreadable config = not connected.
    pub fn is_connected(self, paths: &BuddyPaths) -> bool {
        let Ok(loaded) = load(&self.config_path(paths.home())) else { return false };
        let Some(Value::Object(hooks)) = loaded.root.get("hooks") else { return false };
        self.hook_specs().iter().all(|spec| {
            groups_of(hooks.get(spec.event)).iter().any(|group| {
                handlers_of(group).iter().chain(std::iter::once(group)).any(|handler| {
                    handler
                        .get("command")
                        .and_then(Value::as_str)
                        .is_some_and(|cmd| is_connected_command(cmd, self.raw_value(), spec.arg))
                })
            })
        })
    }

    /// Adds the buddy hooks (replacing any earlier buddy handlers, so it is idempotent). Creates the config file
    /// when it does not exist; leaves a file that is not valid JSON untouched and returns an error.
    pub fn connect(self, paths: &BuddyPaths) -> Result<(), HooksError> {
        let path = self.config_path(paths.home());
        let helper = paths.helper();
        mutate(&path, true, |root| {
            let mut hooks = take_hooks(root, &path)?;
            strip(&mut hooks);
            for spec in self.hook_specs() {
                let mut groups = match hooks.get(spec.event) {
                    None | Some(Value::Null) => Vec::new(),
                    Some(Value::Array(groups)) => groups.clone(),
                    Some(_) => return Err(shape_error(&path, format!("hooks.{} is not an array", spec.event))),
                };
                if self == AgentIntegration::Cursor {
                    // Cursor: `"stop": [{ "command": "..." }]`, no groups
                    groups.push(json!({ "command": self.command(&helper, spec.arg) }));
                    hooks.insert(spec.event.to_string(), Value::Array(groups));
                    continue;
                }
                let handler = json!({ "type": "command", "command": self.command(&helper, spec.arg) });
                let mut group = Map::new();
                if let Some(matcher) = spec.matcher {
                    group.insert("matcher".into(), Value::String(matcher.into()));
                }
                group.insert("hooks".into(), Value::Array(vec![handler]));
                groups.push(Value::Object(group));
                hooks.insert(spec.event.to_string(), Value::Array(groups));
            }
            if self == AgentIntegration::Cursor && !root.contains_key("version") {
                root.insert("version".into(), json!(1)); // Cursor's hooks.json schema version
            }
            root.insert("hooks".into(), Value::Object(hooks));
            Ok(())
        })
        .map(|_| ())
    }

    /// Removes the buddy handlers and nothing else. `hooks` is dropped only if it became empty. A missing file or
    /// one without buddy entries is left alone (no write, no backup).
    pub fn disconnect(self, paths: &BuddyPaths) -> Result<(), HooksError> {
        let path = self.config_path(paths.home());
        mutate(&path, false, |root| {
            if let Some(Value::Object(hooks)) = root.get_mut("hooks") {
                if strip(hooks) && hooks.is_empty() {
                    root.shift_remove("hooks");
                }
            }
            Ok(())
        })
        .map(|_| ())
    }
}

// MARK: command line

/// `"<helper>" <agent> <arg>` in the form 07-hooks.md verified: forward slashes, no quotes unless the path has
/// whitespace or shell metacharacters (then double quotes). The unquoted form works in Git Bash, cmd and PowerShell.
pub fn format_command(helper: &Path, agent: &str, arg: &str) -> String {
    let path = helper.to_string_lossy().replace('\\', "/");
    let path = if needs_quoting(&path) {
        // Inside double quotes bash still expands these three; a backslash keeps them literal.
        let mut quoted = String::with_capacity(path.len() + 2);
        quoted.push('"');
        for c in path.chars() {
            if matches!(c, '"' | '$' | '`') {
                quoted.push('\\');
            }
            quoted.push(c);
        }
        quoted.push('"');
        quoted
    } else {
        path
    };
    format!("{path} {agent} {arg}")
}

fn needs_quoting(path: &str) -> bool {
    path.chars().any(|c| c.is_whitespace() || "\"'`$&|;<>()[]{}*?!#^%\\".contains(c))
}

// MARK: matching

/// Strip marker (port of `AgentIntegration.marker` + the Windows names): a handler is ours when its command
/// has `.claude-buddy/notify.sh`, `.claude-buddy/buddy-notify` or `.claude-buddy/notify.ps1`, with `/` or `\`.
fn is_buddy_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/").to_ascii_lowercase();
    [".claude-buddy/notify.sh", ".claude-buddy/buddy-notify", ".claude-buddy/notify.ps1"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

/// The `isConnected` test for one handler command.
fn is_connected_command(command: &str, agent: &str, arg: &str) -> bool {
    let suffix = format!(" {agent} {arg}");
    command
        .strip_suffix(&suffix)
        .is_some_and(|head| head.to_ascii_lowercase().contains("buddy-notify"))
}

/// Port of `strip`: removes every buddy handler, dropping groups that only contained buddy handlers, and events
/// whose list became empty because of that. Returns whether anything was removed. Anything that is not the
/// expected shape (non-array event, group without a `hooks` list, ...) is left exactly as it is.
fn strip(hooks: &mut Map<String, Value>) -> bool {
    let mut removed_any = false;
    let mut emptied: Vec<String> = Vec::new();
    for (event, value) in hooks.iter_mut() {
        let Value::Array(groups) = value else { continue };
        let mut removed_here = false;
        groups.retain_mut(|group| {
            // a flat entry (Cursor: `{ "command": ... }`) that is ours goes as a whole
            if group.get("command").and_then(Value::as_str).is_some_and(is_buddy_command) {
                removed_here = true;
                return false;
            }
            let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let before = handlers.len();
            handlers.retain(|h| !h.get("command").and_then(Value::as_str).is_some_and(is_buddy_command));
            if handlers.len() == before {
                return true;
            }
            removed_here = true;
            !handlers.is_empty()
        });
        if removed_here {
            removed_any = true;
            if groups.is_empty() {
                emptied.push(event.clone());
            }
        }
    }
    for event in emptied {
        hooks.shift_remove(&event); // not `remove`: with preserve_order that would reorder the keys
    }
    removed_any
}

fn groups_of(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn handlers_of(group: &Value) -> &[Value] {
    group.get("hooks").and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// A copy of `root["hooks"]` to edit: absent or `null` = empty; anything but an object is an error.
fn take_hooks(root: &Map<String, Value>, path: &Path) -> Result<Map<String, Value>, HooksError> {
    match root.get("hooks") {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(hooks)) => Ok(hooks.clone()),
        Some(_) => Err(shape_error(path, "hooks is not an object".to_string())),
    }
}

// MARK: PATH

/// Is one of `names` in a directory of `path_var` (the value of `PATH`)?
fn on_path(path_var: Option<OsString>, names: &[&str]) -> bool {
    let Some(path_var) = path_var else { return false };
    std::env::split_paths(&path_var).any(|dir| names.iter().any(|name| dir.join(name).is_file()))
}

// MARK: errors

#[derive(Debug)]
pub enum HooksError {
    Io { path: PathBuf, source: io::Error },
    /// The file is not valid JSON / not UTF-8 / not an object at the top level; it was left untouched.
    InvalidJson { path: PathBuf, message: String },
    /// Valid JSON, but `hooks` or one of its events has a type we do not dare to overwrite.
    UnexpectedShape { path: PathBuf, message: String },
}

fn shape_error(path: &Path, message: String) -> HooksError {
    HooksError::UnexpectedShape { path: path.to_path_buf(), message }
}

impl fmt::Display for HooksError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // Most often the folder was created by the agent run with sudo, so it belongs to root (a Linux user report).
            HooksError::Io { path, source } if source.kind() == io::ErrorKind::PermissionDenied => {
                let dir = path.parent().unwrap_or(path);
                if cfg!(windows) {
                    write!(f, "{}: permission denied; it was not changed. Is the file read-only?", path.display())
                } else {
                    write!(
                        f,
                        "{}: permission denied; it was not changed. The folder probably belongs to another user (an agent \
                         once run with sudo). Fix it with:  sudo chown -R \"$USER\" '{}'",
                        path.display(),
                        dir.display()
                    )
                }
            }
            HooksError::Io { path, source } => write!(f, "{}: {source}", path.display()),
            HooksError::InvalidJson { path, message } => {
                write!(f, "{} is not valid JSON ({message}); it was not changed", path.display())
            }
            HooksError::UnexpectedShape { path, message } => {
                write!(f, "{}: {message}; it was not changed", path.display())
            }
        }
    }
}

impl std::error::Error for HooksError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            HooksError::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

fn io_error(path: &Path) -> impl FnOnce(io::Error) -> HooksError + '_ {
    move |source| HooksError::Io { path: path.to_path_buf(), source }
}

// MARK: read / write

/// A parsed config plus what is needed to write it back the way it was.
struct Loaded {
    root: Map<String, Value>,
    exists: bool,
    trailing_newline: bool,
    crlf: bool,
}

/// Port of `read`: tolerates a UTF-8 BOM; a missing or empty file is `{}`; anything else that is not a JSON
/// object is an error (and the caller writes nothing).
fn load(path: &Path) -> Result<Loaded, HooksError> {
    let empty = Loaded { root: Map::new(), exists: false, trailing_newline: false, crlf: false };
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(empty),
        Err(e) => return Err(io_error(path)(e)),
    };
    let invalid = |message: String| HooksError::InvalidJson { path: path.to_path_buf(), message };
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let text = std::str::from_utf8(bytes).map_err(|_| invalid("not UTF-8".to_string()))?;
    if text.trim().is_empty() {
        return Ok(Loaded { exists: true, ..empty });
    }
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(root)) => Ok(Loaded {
            root,
            exists: true,
            trailing_newline: text.ends_with('\n'),
            crlf: text.contains("\r\n"),
        }),
        Ok(_) => Err(invalid("the top level is not an object".to_string())),
        Err(e) => Err(invalid(e.to_string())),
    }
}

/// Port of `mutate`: read, change, write atomically, with a one-time backup of the original file.
/// Returns whether the file was written; nothing is written when the change leaves the JSON as it was.
fn mutate(
    path: &Path,
    create_if_missing: bool,
    body: impl FnOnce(&mut Map<String, Value>) -> Result<(), HooksError>,
) -> Result<bool, HooksError> {
    let loaded = load(path)?;
    if !loaded.exists && !create_if_missing {
        return Ok(false);
    }
    let before = serde_json::to_string(&loaded.root).unwrap_or_default(); // compact, order-sensitive
    let mut root = loaded.root.clone();
    body(&mut root)?;
    if serde_json::to_string(&root).unwrap_or_default() == before && loaded.exists {
        return Ok(false);
    }

    // One-time backup, before the first write.
    let backup = with_suffix(path, ".buddy-backup");
    if loaded.exists && !backup.exists() {
        fs::copy(path, &backup).map_err(io_error(path))?;
    }

    // Pretty (2 spaces), original key order, no BOM, the original's line endings and trailing newline.
    let mut text = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| HooksError::InvalidJson {
        path: path.to_path_buf(),
        message: e.to_string(),
    })?;
    if loaded.trailing_newline {
        text.push('\n');
    }
    if loaded.crlf {
        text = text.replace('\n', "\r\n");
    }

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io_error(path))?;
    }
    // Atomic: write next to the file, then rename over it.
    let staged = with_suffix(path, ".buddy-tmp");
    fs::write(&staged, text).map_err(io_error(path))?;
    fs::rename(&staged, path).map_err(|e| {
        let _ = fs::remove_file(&staged);
        io_error(path)(e)
    })?;
    Ok(true)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::test_support::TempDir;

    const ME: AgentIntegration = AgentIntegration::Claude;

    fn paths(dir: &TempDir) -> BuddyPaths {
        BuddyPaths::new(dir.path())
    }

    fn config(dir: &TempDir, agent: AgentIntegration) -> PathBuf {
        agent.config_path(dir.path())
    }

    fn write_config(dir: &TempDir, agent: AgentIntegration, text: &str) {
        let path = config(dir, agent);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn read_text(dir: &TempDir, agent: AgentIntegration) -> String {
        fs::read_to_string(config(dir, agent)).unwrap()
    }

    fn read_json(dir: &TempDir, agent: AgentIntegration) -> Value {
        serde_json::from_str(&read_text(dir, agent)).unwrap()
    }

    /// A settings file as Claude Code writes it, with another tool's hooks in it.
    fn foreign_settings() -> Value {
        json!({
            "permissions": { "allow": ["Bash(git status)"], "deny": [] },
            "env": { "FOO": "1" },
            "hooks": {
                "SessionStart": [
                    { "hooks": [ { "type": "command", "command": "C:/tools/session-start.cmd" } ] }
                ],
                "PostToolUse": [
                    { "matcher": "Edit|Write",
                      "hooks": [ { "type": "command", "command": "C:\\tools\\other-tool\\post-hook.cmd --quiet" } ] }
                ]
            },
            "model": "opus"
        })
    }

    fn pretty_with_newline(value: &Value) -> String {
        format!("{}\n", serde_json::to_string_pretty(value).unwrap())
    }

    fn buddy_handlers(value: &Value) -> usize {
        let Some(hooks) = value.get("hooks").and_then(Value::as_object) else { return 0 };
        hooks
            .values()
            .flat_map(|groups| groups_of(Some(groups)).iter())
            .flat_map(|group| handlers_of(group).iter())
            .filter(|h| h.get("command").and_then(Value::as_str).is_some_and(is_buddy_command))
            .count()
    }

    // MARK: command line

    #[test]
    fn command_is_forward_slashes_and_unquoted_when_plain() {
        let helper = Path::new(r"C:\Users\me\.claude-buddy\buddy-notify.exe");
        assert_eq!(ME.command(helper, "done"), "C:/Users/me/.claude-buddy/buddy-notify.exe claude done");
        assert_eq!(
            AgentIntegration::Codex.command(helper, "permission"),
            "C:/Users/me/.claude-buddy/buddy-notify.exe codex permission"
        );
        // 8.3 short names (a tilde in the middle) and non-ASCII names stay unquoted
        let short = Path::new(r"C:\Users\ME~1\.claude-buddy\buddy-notify.exe");
        assert_eq!(ME.command(short, "dismiss"), "C:/Users/ME~1/.claude-buddy/buddy-notify.exe claude dismiss");
        let persian = Path::new(r"C:\Users\کاربر\.claude-buddy\buddy-notify.exe");
        assert_eq!(ME.command(persian, "done"), "C:/Users/کاربر/.claude-buddy/buddy-notify.exe claude done");
    }

    #[test]
    fn mac_command_is_the_plain_helper_path() {
        let helper = Path::new("/Users/me/.claude-buddy/buddy-notify");
        assert_eq!(ME.command(helper, "done"), "/Users/me/.claude-buddy/buddy-notify claude done");
        let spaced = Path::new("/Users/John Smith/.claude-buddy/buddy-notify");
        assert_eq!(ME.command(spaced, "waiting"), r#""/Users/John Smith/.claude-buddy/buddy-notify" claude waiting"#);
        assert!(is_buddy_command("/Users/me/.claude-buddy/buddy-notify claude done"));
    }

    #[test]
    fn command_is_double_quoted_with_spaces_or_metacharacters() {
        let spaced = Path::new(r"C:\Users\John Smith\.claude-buddy\buddy-notify.exe");
        assert_eq!(
            ME.command(spaced, "done"),
            r#""C:/Users/John Smith/.claude-buddy/buddy-notify.exe" claude done"#
        );
        for odd in ["C:/Users/a&b", "C:/Users/(x86)", "C:/Users/a;b", "C:/Users/a'b", "C:/Users/100%"] {
            let helper = PathBuf::from(odd).join(".claude-buddy").join("buddy-notify.exe");
            assert!(ME.command(&helper, "done").starts_with('"'), "{odd} should be quoted");
        }
        // `$` and backticks would still expand inside double quotes in bash, so they are escaped
        let dollar = Path::new(r"C:\Users\a$b\.claude-buddy\buddy-notify.exe");
        assert_eq!(ME.command(dollar, "done"), r#""C:/Users/a\$b/.claude-buddy/buddy-notify.exe" claude done"#);
    }

    #[test]
    fn quoted_command_still_counts_as_connected_and_is_stripped() {
        let cmd = r#""C:/Users/John Smith/.claude-buddy/buddy-notify.exe" claude done"#;
        assert!(is_connected_command(cmd, "claude", "done"));
        assert!(!is_connected_command(cmd, "claude", "dismiss"));
        assert!(!is_connected_command(cmd, "codex", "done"));
        assert!(is_buddy_command(cmd));
    }

    #[test]
    fn strip_marker_accepts_both_separators_and_all_three_names_only() {
        for cmd in [
            r#""/Users/x/.claude-buddy/notify.sh" claude done"#,
            r"C:/Users/me/.claude-buddy/buddy-notify.exe claude done",
            r"C:\Users\me\.claude-buddy\buddy-notify.exe claude done",
            r#"powershell -NoProfile -File "C:\Users\me\.claude-buddy\notify.ps1" claude done"#,
            r"C:\Users\me\.CLAUDE-BUDDY\Buddy-Notify.exe claude done",
        ] {
            assert!(is_buddy_command(cmd), "{cmd}");
        }
        for cmd in [
            r"C:/tools/my-notify.sh arg",               // a notify.sh that is not ours
            r"C:/Users/me/.claude-buddy-backup/notify.sh",
            r"C:/Users/me/.claude/hooks/buddy-notify.exe", // right name, wrong folder
            r"C:\tools\other-tool\post-hook.cmd --quiet",
            "",
        ] {
            assert!(!is_buddy_command(cmd), "{cmd}");
        }
    }

    // MARK: connect / disconnect

    #[test]
    fn connect_creates_the_config_with_all_claude_hooks() {
        let dir = TempDir::new();
        let p = paths(&dir);
        assert!(!ME.is_connected(&p));
        ME.connect(&p).unwrap();
        assert!(ME.is_connected(&p));

        let text = read_text(&dir, ME);
        assert!(!text.starts_with('\u{feff}'), "no BOM");
        assert!(!text.ends_with('\n'), "a new file has no trailing newline (the original had none)");
        assert!(text.contains("\n  \"hooks\": {\n    \"Stop\": ["), "pretty printed with 2 spaces:\n{text}");
        let helper = p.helper().to_string_lossy().replace('\\', "/");
        let value = read_json(&dir, ME);
        let hooks = &value["hooks"];
        assert_eq!(hooks["Stop"][0]["hooks"][0]["type"], "command");
        assert_eq!(hooks["Stop"][0]["hooks"][0]["command"], format!("{helper} claude done"));
        assert_eq!(hooks["Stop"][0].get("matcher"), None);
        assert_eq!(hooks["Notification"][0]["hooks"][0]["command"], format!("{helper} claude waiting"));
        assert_eq!(hooks["UserPromptSubmit"][0]["hooks"][0]["command"], format!("{helper} claude dismiss"));
        assert_eq!(hooks["PostToolUse"][0]["matcher"], "*");
        assert_eq!(hooks["PostToolUse"][0]["hooks"][0]["command"], format!("{helper} claude dismiss"));
        assert_eq!(buddy_handlers(&value), 5);
    }

    #[test]
    fn cursor_connect_adds_flat_entries_and_keeps_everything_else() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let cursor = AgentIntegration::Cursor;
        // Cursor's own example config (cursor.com/docs/agent/hooks)
        let original = json!({
            "version": 1,
            "hooks": {
                "afterFileEdit": [{ "command": ".cursor/hooks/format.sh" }],
                "beforeShellExecution": [{ "command": ".cursor/hooks/guard.sh", "matcher": "curl|wget", "failClosed": true }],
                "stop": [{ "command": ".cursor/hooks/notify.sh", "loop_limit": 5 }]
            }
        });
        write_config(&dir, cursor, &pretty_with_newline(&original));
        cursor.connect(&p).unwrap();
        assert!(cursor.is_connected(&p));
        let v = read_json(&dir, cursor);
        assert_eq!(v["version"], json!(1));
        let stop = v["hooks"]["stop"].as_array().unwrap();
        assert_eq!(stop[0]["command"], json!(".cursor/hooks/notify.sh"));
        assert!(stop[1]["command"].as_str().unwrap().ends_with(" cursor done"));
        assert!(stop[1].get("hooks").is_none(), "flat entry, no Claude-style group");
        assert!(v["hooks"]["beforeSubmitPrompt"][0]["command"].as_str().unwrap().ends_with(" cursor dismiss"));
        assert!(v["hooks"]["postToolUse"][0]["command"].as_str().unwrap().ends_with(" cursor dismiss"));
        assert_eq!(v["hooks"]["beforeShellExecution"], original["hooks"]["beforeShellExecution"]);
        // connecting twice does not duplicate
        cursor.connect(&p).unwrap();
        assert_eq!(read_json(&dir, cursor)["hooks"]["stop"].as_array().unwrap().len(), 2);
        // disconnect restores the user's file
        cursor.disconnect(&p).unwrap();
        assert!(!cursor.is_connected(&p));
        assert_eq!(read_json(&dir, cursor), original);
    }

    #[test]
    fn cursor_connect_creates_the_file_with_a_version() {
        let dir = TempDir::new();
        let p = paths(&dir);
        AgentIntegration::Cursor.connect(&p).unwrap();
        let v = read_json(&dir, AgentIntegration::Cursor);
        assert_eq!(v["version"], json!(1));
        assert_eq!(v["hooks"].as_object().unwrap().len(), 3);
        assert!(config(&dir, AgentIntegration::Cursor).ends_with(Path::new(".cursor").join("hooks.json")));
    }

    #[test]
    fn connect_codex_creates_the_folder_and_its_own_hook_set() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let codex = AgentIntegration::Codex;
        codex.connect(&p).unwrap();
        assert!(codex.is_connected(&p));
        assert!(!ME.is_connected(&p), "Claude's config is a different file");
        let hooks = &read_json(&dir, codex)["hooks"];
        assert_eq!(hooks["PermissionRequest"][0]["matcher"], "*");
        assert!(hooks["PermissionRequest"][0]["hooks"][0]["command"].as_str().unwrap().ends_with(" codex permission"));
        assert_eq!(hooks.get("Notification"), None);
        assert!(config(&dir, codex).ends_with(Path::new(".codex").join("hooks.json")));
    }

    #[test]
    fn permission_denied_says_what_to_do() {
        let e = HooksError::Io {
            path: PathBuf::from("/home/me/.claude/settings.json"),
            source: io::Error::from(io::ErrorKind::PermissionDenied),
        };
        let text = e.to_string();
        assert!(text.contains("permission denied; it was not changed"), "{text}");
        if !cfg!(windows) {
            assert!(text.contains("sudo chown -R \"$USER\" '/home/me/.claude'"), "{text}");
        }
    }

    #[test]
    fn connect_twice_does_not_duplicate_handlers() {
        let dir = TempDir::new();
        let p = paths(&dir);
        write_config(&dir, ME, &pretty_with_newline(&foreign_settings()));
        ME.connect(&p).unwrap();
        let once = read_text(&dir, ME);
        ME.connect(&p).unwrap();
        ME.connect(&p).unwrap();
        assert_eq!(read_text(&dir, ME), once, "connecting again changes nothing");
        assert_eq!(buddy_handlers(&read_json(&dir, ME)), 5);
        assert!(ME.is_connected(&p));
    }

    #[test]
    fn disconnect_restores_the_original_byte_for_byte_when_it_was_formatted_the_same_way() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let original = pretty_with_newline(&foreign_settings());
        write_config(&dir, ME, &original);

        ME.connect(&p).unwrap();
        assert_ne!(read_text(&dir, ME), original);
        assert!(ME.is_connected(&p));
        ME.disconnect(&p).unwrap();

        assert!(read_text(&dir, ME) == original, "disconnect must give back the original file");
        assert!(!ME.is_connected(&p));
    }

    #[test]
    fn disconnect_gives_a_semantically_equal_file_when_the_original_was_formatted_differently() {
        let dir = TempDir::new();
        let p = paths(&dir);
        // 4-space indent, CRLF, no trailing newline, a BOM
        let original = format!(
            "\u{feff}{}",
            serde_json::to_string_pretty(&foreign_settings()).unwrap().replace("  ", "    ").replace('\n', "\r\n")
        );
        write_config(&dir, ME, &original);
        ME.connect(&p).unwrap();
        ME.disconnect(&p).unwrap();
        let after = read_text(&dir, ME);
        assert!(!after.starts_with('\u{feff}'), "the BOM is dropped");
        assert!(after.contains("\r\n"), "CRLF line endings are kept");
        assert!(!after.ends_with('\n'));
        let before: Value = serde_json::from_str(original.trim_start_matches('\u{feff}')).unwrap();
        assert!(serde_json::from_str::<Value>(&after).unwrap() == before);
    }

    #[test]
    fn other_tools_hooks_and_keys_are_untouched_and_in_order() {
        let dir = TempDir::new();
        let p = paths(&dir);
        write_config(&dir, ME, &pretty_with_newline(&foreign_settings()));
        ME.connect(&p).unwrap();

        let after = read_json(&dir, ME);
        let foreign = foreign_settings();
        // every foreign key is still there, with the same value, at the same position
        let after_keys: Vec<_> = after.as_object().unwrap().keys().cloned().collect();
        assert_eq!(after_keys, ["permissions", "env", "hooks", "model"]);
        assert_eq!(after["permissions"], foreign["permissions"]);
        assert_eq!(after["env"], foreign["env"]);
        assert_eq!(after["model"], foreign["model"]);
        assert_eq!(after["hooks"]["SessionStart"], foreign["hooks"]["SessionStart"]);
        // the foreign PostToolUse handler (a .cmd path with backslashes) is still first, ours is added after it
        let post = after["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 2);
        assert_eq!(post[0], foreign["hooks"]["PostToolUse"][0]);
        assert_eq!(post[1]["matcher"], "*");
        let hook_keys: Vec<_> = after["hooks"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(hook_keys, ["SessionStart", "PostToolUse", "Stop", "Notification", "PermissionRequest", "UserPromptSubmit"]);
    }

    #[test]
    fn a_group_shared_with_a_foreign_handler_keeps_the_foreign_handler() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let mixed = json!({
            "hooks": { "Stop": [ { "hooks": [
                { "type": "command", "command": "C:/tools/other.cmd" },
                { "type": "command", "command": "\"C:\\Users\\me\\.claude-buddy\\notify.ps1\" claude done" },
                { "type": "command", "command": "C:/tools/third.cmd" }
            ] } ] }
        });
        write_config(&dir, ME, &pretty_with_newline(&mixed));
        ME.connect(&p).unwrap();
        let stop = read_json(&dir, ME)["hooks"]["Stop"].clone();
        assert_eq!(stop[0]["hooks"], json!([
            { "type": "command", "command": "C:/tools/other.cmd" },
            { "type": "command", "command": "C:/tools/third.cmd" }
        ]));
        assert_eq!(stop.as_array().unwrap().len(), 2, "plus our own group");
        ME.disconnect(&p).unwrap();
        assert!(read_json(&dir, ME)["hooks"]["Stop"][0]["hooks"].as_array().unwrap().len() == 2);
    }

    #[test]
    fn earlier_buddy_entries_in_any_form_are_replaced() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let old = json!({
            "hooks": {
                "Stop": [ { "hooks": [ { "type": "command", "command": "\"/Users/x/.claude-buddy/notify.sh\" claude done" } ] } ],
                "Notification": [ { "hooks": [ { "type": "command", "command": "C:\\Users\\old\\.claude-buddy\\buddy-notify.exe claude waiting" } ] } ]
            }
        });
        write_config(&dir, ME, &pretty_with_newline(&old));
        ME.connect(&p).unwrap();
        let value = read_json(&dir, ME);
        assert_eq!(buddy_handlers(&value), 5, "no stale entries left next to the new ones");
        assert_eq!(value["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(value["hooks"]["Notification"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn invalid_json_is_left_untouched() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let broken = "{ \"hooks\": { \"Stop\": [ ";
        write_config(&dir, ME, broken);
        assert!(matches!(ME.connect(&p), Err(HooksError::InvalidJson { .. })));
        assert!(matches!(ME.disconnect(&p), Err(HooksError::InvalidJson { .. })));
        assert!(!ME.is_connected(&p));
        assert_eq!(read_text(&dir, ME), broken);
        assert!(!with_suffix(&config(&dir, ME), ".buddy-backup").exists(), "no backup, nothing was written");
        assert!(!with_suffix(&config(&dir, ME), ".buddy-tmp").exists());
        let err = ME.connect(&p).unwrap_err().to_string();
        assert!(err.contains("settings.json") && err.contains("not valid JSON"), "{err}");
    }

    #[test]
    fn a_top_level_array_or_non_utf8_file_is_an_error_too() {
        let dir = TempDir::new();
        let p = paths(&dir);
        write_config(&dir, ME, "[1, 2, 3]");
        assert!(matches!(ME.connect(&p), Err(HooksError::InvalidJson { .. })));
        assert_eq!(read_text(&dir, ME), "[1, 2, 3]");
        // UTF-16 with a BOM (what PowerShell 5's Out-File writes)
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("{}".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        fs::write(config(&dir, ME), &utf16).unwrap();
        assert!(matches!(ME.connect(&p), Err(HooksError::InvalidJson { .. })));
        assert_eq!(fs::read(config(&dir, ME)).unwrap(), utf16);
    }

    #[test]
    fn unexpected_shapes_of_hooks_are_not_overwritten() {
        let dir = TempDir::new();
        let p = paths(&dir);
        for text in [r#"{"hooks": [1]}"#, r#"{"hooks": {"Stop": "oops"}}"#] {
            write_config(&dir, ME, text);
            assert!(matches!(ME.connect(&p), Err(HooksError::UnexpectedShape { .. })), "{text}");
            assert_eq!(read_text(&dir, ME), text);
        }
        // disconnect has nothing to remove from such a file and must not rewrite it
        ME.disconnect(&p).unwrap();
        assert_eq!(read_text(&dir, ME), r#"{"hooks": {"Stop": "oops"}}"#);
        // `"hooks": null` counts as absent
        write_config(&dir, ME, r#"{"hooks": null, "model": "x"}"#);
        ME.connect(&p).unwrap();
        assert!(ME.is_connected(&p));
        assert_eq!(read_json(&dir, ME)["model"], "x");
    }

    #[test]
    fn a_bom_is_tolerated_on_read_and_never_written() {
        let dir = TempDir::new();
        let p = paths(&dir);
        write_config(&dir, ME, &format!("\u{feff}{}", serde_json::to_string_pretty(&foreign_settings()).unwrap()));
        ME.connect(&p).unwrap();
        assert!(ME.is_connected(&p));
        let bytes = fs::read(config(&dir, ME)).unwrap();
        assert!(!bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        assert_eq!(buddy_handlers(&read_json(&dir, ME)), 5);
        ME.disconnect(&p).unwrap();
        assert!(read_json(&dir, ME) == foreign_settings());
    }

    #[test]
    fn empty_whitespace_and_missing_files_count_as_empty_objects() {
        let dir = TempDir::new();
        let p = paths(&dir);
        // missing: disconnect does not create a file
        ME.disconnect(&p).unwrap();
        assert!(!config(&dir, ME).exists());
        for content in ["", "  \r\n\t"] {
            write_config(&dir, ME, content);
            ME.connect(&p).unwrap();
            assert!(ME.is_connected(&p), "{content:?}");
            fs::remove_file(config(&dir, ME)).unwrap();
            fs::remove_file(with_suffix(&config(&dir, ME), ".buddy-backup")).unwrap();
        }
    }

    #[test]
    fn disconnect_removes_hooks_only_when_it_became_empty() {
        let dir = TempDir::new();
        let p = paths(&dir);
        // only buddy entries + another key: `hooks` goes, the rest stays
        write_config(&dir, ME, r#"{"model": "x"}"#);
        ME.connect(&p).unwrap();
        ME.disconnect(&p).unwrap();
        assert_eq!(read_json(&dir, ME), json!({"model": "x"}));
        // an empty `hooks` object that was there before is not ours to delete: file untouched
        let text = "{\n  \"hooks\": {},\n  \"model\": \"x\"\n}";
        write_config(&dir, ME, text);
        ME.disconnect(&p).unwrap();
        assert_eq!(read_text(&dir, ME), text);
    }

    #[test]
    fn disconnect_without_buddy_entries_does_not_rewrite_the_file() {
        let dir = TempDir::new();
        let p = paths(&dir);
        // odd formatting that a rewrite would change
        let text = "{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"C:/t/x.cmd\"}]}]}}";
        write_config(&dir, ME, text);
        ME.disconnect(&p).unwrap();
        assert_eq!(read_text(&dir, ME), text);
        assert!(!with_suffix(&config(&dir, ME), ".buddy-backup").exists());
    }

    #[test]
    fn backup_is_made_once_before_the_first_write() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let original = pretty_with_newline(&foreign_settings());
        write_config(&dir, ME, &original);
        let backup = with_suffix(&config(&dir, ME), ".buddy-backup");

        ME.connect(&p).unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), original);
        // the user changes the file by hand, then toggles again: the first backup stays
        write_config(&dir, ME, r#"{"model": "changed"}"#);
        ME.connect(&p).unwrap();
        ME.disconnect(&p).unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), original);
        // a brand new file has nothing to back up
        let fresh = TempDir::new();
        ME.connect(&paths(&fresh)).unwrap();
        assert!(!with_suffix(&config(&fresh, ME), ".buddy-backup").exists());
    }

    #[test]
    fn trailing_newline_and_crlf_follow_the_original() {
        let dir = TempDir::new();
        let p = paths(&dir);
        let value = json!({"model": "x"});
        for (text, newline, crlf) in [
            (serde_json::to_string_pretty(&value).unwrap(), false, false),
            (pretty_with_newline(&value), true, false),
            (pretty_with_newline(&value).replace('\n', "\r\n"), true, true),
        ] {
            write_config(&dir, ME, &text);
            ME.connect(&p).unwrap();
            let after = read_text(&dir, ME);
            assert_eq!(after.ends_with('\n'), newline);
            assert_eq!(after.contains("\r\n"), crlf);
            if crlf {
                assert_eq!(after.matches('\n').count(), after.matches("\r\n").count(), "no bare LF mixed in");
            }
            ME.disconnect(&p).unwrap();
            assert!(read_text(&dir, ME) == text, "round trip keeps the formatting");
        }
    }

    #[test]
    fn key_order_is_preserved_not_sorted() {
        let dir = TempDir::new();
        let p = paths(&dir);
        write_config(&dir, ME, "{\n  \"zebra\": 1,\n  \"alpha\": 2,\n  \"hooks\": {\n    \"Stop\": []\n  },\n  \"mid\": 3\n}");
        ME.connect(&p).unwrap();
        let value = read_json(&dir, ME);
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["zebra", "alpha", "hooks", "mid"]);
    }

    #[test]
    fn is_connected_needs_every_hook() {
        let dir = TempDir::new();
        let p = paths(&dir);
        ME.connect(&p).unwrap();
        let mut value = read_json(&dir, ME);
        value["hooks"].as_object_mut().unwrap().shift_remove("Notification");
        write_config(&dir, ME, &serde_json::to_string_pretty(&value).unwrap());
        assert!(!ME.is_connected(&p));
        // a foreign handler is not a buddy handler
        value["hooks"]["Notification"] = json!([{ "hooks": [ { "type": "command", "command": "C:/x/notify.exe claude waiting" } ] }]);
        write_config(&dir, ME, &serde_json::to_string_pretty(&value).unwrap());
        assert!(!ME.is_connected(&p));
    }

    // MARK: tool detection

    #[test]
    fn tool_detection() {
        let dir = TempDir::new();
        assert!(!ME.tool_detected(dir.path()));
        fs::create_dir(dir.path().join(".claude")).unwrap();
        assert!(ME.tool_detected(dir.path()));

        let codex = AgentIntegration::Codex;
        fs::create_dir(dir.path().join(".codex")).unwrap();
        assert!(codex.tool_detected(dir.path()));
    }

    #[cfg(windows)]
    #[test]
    fn codex_is_found_on_path_as_exe_or_cmd() {
        let bin = TempDir::new();
        let path_var = std::env::join_paths([Path::new(r"C:\nonexistent-dir"), bin.path()]).ok();
        let names = ["codex.exe", "codex.cmd"];
        assert!(!on_path(path_var.clone(), &names));
        assert!(!on_path(None, &names));
        fs::write(bin.path().join("codex.cmd"), "@echo off").unwrap();
        assert!(on_path(path_var.clone(), &names));
        fs::remove_file(bin.path().join("codex.cmd")).unwrap();
        fs::write(bin.path().join("codex.exe"), "").unwrap();
        assert!(on_path(path_var, &names));
    }

    #[cfg(not(windows))]
    #[test]
    fn codex_is_found_on_path() {
        let bin = TempDir::new();
        let path_var = std::env::join_paths([Path::new("/nonexistent-dir"), bin.path()]).ok();
        assert!(!on_path(path_var.clone(), &["codex"]));
        assert!(!on_path(None, &["codex"]));
        fs::write(bin.path().join("codex"), "").unwrap();
        assert!(on_path(path_var, &["codex"]));
    }

    // MARK: the real file (explicit run only)

    /// Copies the real `%USERPROFILE%\.claude\settings.json` into a temp home (read-only on the original), connects,
    /// checks that only buddy entries were added, disconnects and compares with the copy byte for byte.
    /// Prints counts and positions only, never the content. Run with:
    /// `cargo test realistic_copy_of_the_real_settings -- --ignored --nocapture`
    #[test]
    #[ignore = "reads the real settings.json (copy only); run explicitly"]
    fn realistic_copy_of_the_real_settings() {
        let real = PathBuf::from(std::env::var_os("USERPROFILE").unwrap()).join(".claude").join("settings.json");
        let original = fs::read(&real).expect("no real settings.json to copy");

        let dir = TempDir::new();
        let p = paths(&dir);
        let copy = config(&dir, ME);
        fs::create_dir_all(copy.parent().unwrap()).unwrap();
        fs::write(&copy, &original).unwrap();

        ME.connect(&p).unwrap();
        let connected = fs::read(&copy).unwrap();
        let before: Value = serde_json::from_slice(original.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&original)).unwrap();
        let after: Value = serde_json::from_slice(&connected).unwrap();
        // 1. stripping the buddy entries from the connected file gives the original JSON back
        let mut stripped = after.clone();
        let mut hooks = stripped["hooks"].as_object().unwrap().clone();
        let removed = strip(&mut hooks);
        stripped.as_object_mut().unwrap().insert("hooks".into(), Value::Object(hooks));
        if before.get("hooks").is_none() {
            stripped.as_object_mut().unwrap().shift_remove("hooks");
        }
        // 2. and the number of added buddy handlers is exactly 4
        let added = buddy_handlers(&after) - buddy_handlers(&before);
        // 3. line-level diff: lines of the original that are missing in the connected file
        let (old_text, new_text) = (String::from_utf8_lossy(&original), String::from_utf8_lossy(&connected));
        let new_lines: Vec<&str> = new_text.lines().collect();
        let missing = old_text.lines().filter(|l| !new_lines.contains(l)).count();
        println!(
            "original: {} bytes, BOM {}, CRLF {}, trailing newline {}, buddy handlers before {}",
            original.len(),
            original.starts_with(&[0xEF, 0xBB, 0xBF]),
            old_text.contains("\r\n"),
            old_text.ends_with('\n'),
            buddy_handlers(&before)
        );
        println!(
            "connected: {} bytes, {} added handlers, {} lines added, {} original lines missing, stripped==original: {}",
            connected.len(),
            added,
            new_lines.len() as i64 - old_text.lines().count() as i64,
            missing,
            stripped == before
        );
        assert!(removed, "connect added buddy entries");
        assert!(stripped == before, "only buddy entries were added");
        assert_eq!(added, 4);

        ME.disconnect(&p).unwrap();
        let restored = fs::read(&copy).unwrap();
        let identical = restored == original;
        let first_diff = original.iter().zip(&restored).position(|(a, b)| a != b);
        println!(
            "disconnected: {} bytes, byte-identical: {identical}, first differing offset: {first_diff:?}, length delta {}",
            restored.len(),
            restored.len() as i64 - original.len() as i64
        );
        let restored_json: Value = serde_json::from_slice(&restored).unwrap();
        assert!(restored_json == before, "semantically equal after disconnect");
        // the temp home (with the copy) is removed when `dir` drops
    }
}
