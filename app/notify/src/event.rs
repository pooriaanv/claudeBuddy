//! The event file format (03-core-logic.md "inbox", `InboxMessage.parse` on the app side).
//!
//! ```text
//! <agent> <event>\n
//! @host <full exe path>\n        (not for dismiss; only when the host was found)
//! <payload bytes, unchanged>
//! ```

/// Port of the `{ echo "$agent $event"; ...; read_payload; } > "$f.tmp"` block of notify.sh.
/// `host` must be `None` for `dismiss` (the caller does not even look it up).
pub fn file_contents(agent: &str, event: &str, host: Option<&str>, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 64);
    out.extend_from_slice(agent.as_bytes());
    out.push(b' ');
    out.extend_from_slice(event.as_bytes());
    out.push(b'\n');
    if let Some(host) = host.filter(|h| !h.is_empty()) {
        out.extend_from_slice(b"@host ");
        out.extend_from_slice(host.as_bytes());
        out.push(b'\n');
    }
    out.extend_from_slice(payload);
    out
}

/// `<unix-seconds>-<pid>` (notify.sh: `$(date +%s)-$$`); the inbox sorts by this name.
pub fn base_name(unix_secs: u64, pid: u32) -> String {
    format!("{unix_secs}-{pid}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_host_then_payload_unchanged() {
        let payload = br#"{"session_id":"s1","cwd":"C:\\Users\\me\\Work\\my-app"}"#;
        let got = file_contents("claude", "done", Some(r"C:\Program Files\App\Claude.exe"), payload);
        let mut want = br"claude done
@host C:\Program Files\App\Claude.exe
"
        .to_vec();
        want.extend_from_slice(payload);
        assert_eq!(got, want);
    }

    #[test]
    fn no_host_line_without_a_host() {
        assert_eq!(file_contents("codex", "auto", None, b"{}"), b"codex auto\n{}");
        assert_eq!(file_contents("codex", "auto", Some(""), b"{}"), b"codex auto\n{}");
    }

    #[test]
    fn empty_payload_leaves_only_the_header() {
        assert_eq!(file_contents("claude", "dismiss", None, b""), b"claude dismiss\n");
    }

    #[test]
    fn payload_bytes_are_not_touched() {
        // CRLF, a BOM and invalid UTF-8 pass through byte for byte (the shell script just `cat`s stdin).
        let payload = b"\xEF\xBB\xBF{\"a\":\r\n1}\xFF\xFE";
        let got = file_contents("claude", "done", None, payload);
        assert!(got.ends_with(payload));
        assert!(got.starts_with(b"claude done\n"));
    }

    #[test]
    fn file_name_is_seconds_dash_pid() {
        assert_eq!(base_name(1_760_000_000, 4242), "1760000000-4242");
    }
}
