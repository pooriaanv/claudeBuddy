//! Argument forms of `notify.sh` (port of its two `case` statements).
//!
//! ```text
//! buddy-notify done|waiting|permission|dismiss [json]    original form (agent = claude)
//! buddy-notify <agent> <event> [json]                    agent: claude | codex | any name
//! buddy-notify codex '{"type":"agent-turn-complete",...}' Codex legacy `notify = [...]`
//! ```

/// What the command line asked for.
#[derive(Debug, PartialEq, Eq)]
pub struct Invocation {
    pub agent: String,
    pub event: String,
    /// The JSON payload given as an argument; empty means "read stdin" (if stdin is not a console).
    pub payload: String,
}

/// Port of the argument handling at the top of notify.sh. `args` excludes the program name.
pub fn parse(args: &[String]) -> Invocation {
    // `$n` in sh: an unset argument and an empty one behave the same everywhere below.
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");

    let first = arg(0);
    // case "$1" in done|waiting|permission|dismiss) agent=claude; event=$1; payload=$2 ;;
    //              *) agent=${1:-agent}; event=$2; payload=$3 ;; esac
    let (agent, mut event, mut payload) = match first {
        "done" | "waiting" | "permission" | "dismiss" => ("claude", first, arg(1)),
        _ => (if first.is_empty() { "agent" } else { first }, arg(1), arg(2)),
    };
    // case "$event" in "{"*) payload=$event; event=auto ;; esac   (JSON passed where the event goes: Codex notify)
    if event.starts_with('{') {
        payload = event;
        event = "auto";
    }
    // event=${event:-auto}
    if event.is_empty() {
        event = "auto";
    }
    Invocation { agent: agent.to_string(), event: event.to_string(), payload: payload.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> Invocation {
        parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    fn inv(agent: &str, event: &str, payload: &str) -> Invocation {
        Invocation { agent: agent.into(), event: event.into(), payload: payload.into() }
    }

    #[test]
    fn original_single_word_forms_mean_claude() {
        for event in ["done", "waiting", "permission", "dismiss"] {
            assert_eq!(p(&[event]), inv("claude", event, ""));
        }
        assert_eq!(p(&["done", "{\"a\":1}"]), inv("claude", "done", "{\"a\":1}"));
    }

    #[test]
    fn agent_event_payload_form() {
        assert_eq!(p(&["claude", "done"]), inv("claude", "done", ""));
        assert_eq!(p(&["codex", "permission", "{\"x\":1}"]), inv("codex", "permission", "{\"x\":1}"));
        assert_eq!(p(&["gemini", "waiting"]), inv("gemini", "waiting", ""));
    }

    #[test]
    fn json_where_the_event_goes_becomes_the_payload_with_event_auto() {
        let json = r#"{"type":"agent-turn-complete","cwd":"C:\\Users\\me\\Work\\my-app"}"#;
        assert_eq!(p(&["codex", json]), inv("codex", "auto", json));
        // the event slot wins over a third argument, exactly like the shell script
        assert_eq!(p(&["codex", json, "ignored"]), inv("codex", "auto", json));
    }

    #[test]
    fn missing_or_empty_event_is_auto() {
        assert_eq!(p(&["codex"]), inv("codex", "auto", ""));
        assert_eq!(p(&["codex", ""]), inv("codex", "auto", ""));
        assert_eq!(p(&["codex", "", "{\"a\":1}"]), inv("codex", "auto", "{\"a\":1}"));
    }

    #[test]
    fn no_arguments_or_empty_agent_is_the_generic_agent() {
        assert_eq!(p(&[]), inv("agent", "auto", ""));
        assert_eq!(p(&[""]), inv("agent", "auto", ""));
        assert_eq!(p(&["", "done"]), inv("agent", "done", ""));
    }

    #[test]
    fn an_event_word_is_only_special_as_the_first_argument() {
        // `codex done` is agent=codex event=done; `done` first is agent=claude
        assert_eq!(p(&["codex", "done"]), inv("codex", "done", ""));
        assert_eq!(p(&["done", "dismiss"]), inv("claude", "done", "dismiss"));
    }
}
