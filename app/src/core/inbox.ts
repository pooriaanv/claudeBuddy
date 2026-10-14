// port of Sources/BuddyCore/Inbox.swift (Mac reference v0.0.9). Parsing only: the inbox directory
// (drain/clean) is filesystem work and lives on the Rust side.

/// One event file dropped by `notify`.
///
/// File format: first line `"<source> <event>"`, then optional `@key value` lines (e.g. `@host C:\...\Code.exe`),
/// then the hook's JSON payload. The original single-word first line (`done` / `waiting` / `dismiss`) means source `claude`.
export interface InboxMessage {
  source: string;
  event: string;
  payload: Record<string, unknown>;
  meta: Record<string, string>;
}

/// Foundation's `trimmingCharacters(in: .whitespacesAndNewlines)`: Unicode Z*, U+0009-U+000D and U+0085
/// (not JS `trim()`, which also strips U+FEFF but not U+0085).
export function trimWhitespacesAndNewlines(s: string): string {
  return s.replace(/^[\u0009-\u000D\u0085\p{Z}]+|[\u0009-\u000D\u0085\p{Z}]+$/gu, "");
}

/// `JSON.parse` that only accepts objects (Swift `as? [String: Any]`): arrays, primitives and bad JSON give null.
export function parseJSONObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/// Swift `split(separator: " ", maxSplits: 1)` with the default `omittingEmptySubsequences: true`.
function splitOnceOnSpace(s: string): string[] {
  const result: string[] = [];
  if (s.length === 0) return result;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === " ") {
      const didAppend = start !== i;
      if (didAppend) result.push(s.slice(start, i));
      i++;
      start = i;
      if (didAppend && result.length === 1) break;
      continue;
    }
    i++;
  }
  if (start !== s.length) result.push(s.slice(start));
  return result;
}

export const InboxMessage = {
  // port of Inbox.swift InboxMessage.parse
  parse(text: string): InboxMessage {
    // Windows adaptation 1: event files written by cmd/PowerShell may use CRLF.
    text = text.replace(/\r\n/g, "\n");

    const nl = text.indexOf("\n");
    const header = nl < 0 ? text : text.slice(0, nl);
    let rest = nl < 0 ? "" : text.slice(nl + 1);
    const meta: Record<string, string> = {};
    while (rest.startsWith("@")) {
      const e = rest.indexOf("\n");
      const line = e < 0 ? rest : rest.slice(0, e);
      rest = e < 0 ? "" : rest.slice(e + 1);
      const parts = splitOnceOnSpace(line.slice(1));
      if (parts.length === 2) meta[parts[0]] = parts[1];
    }
    const body = trimWhitespacesAndNewlines(rest);
    const words = header.split(" ").filter((w) => w !== "");
    const source = words.length >= 2 ? words[0] : "claude";
    const event = words.length >= 2 ? words[1] : (words[0] ?? "");

    let payload: Record<string, unknown> = {};
    if (body !== "") {
      const obj = parseJSONObject(body);
      payload = obj ?? { message: body };
    }
    return { source, event, payload, meta };
  },
};
