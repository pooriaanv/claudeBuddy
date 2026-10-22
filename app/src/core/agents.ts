// port of Sources/BuddyCore/Agents.swift (Mac reference v0.0.9)

import type { InboxMessage } from "./inbox";

/// What an agent told the buddy. Swift `AgentEvent.Kind` (enum with an associated value for `needsAttention`).
export type AgentEventKind =
  /// The agent finished its turn and is waiting for you.
  | { type: "finished" }
  /// The agent is blocked on a permission prompt.
  | { type: "needsPermission" }
  /// The agent wants you for some other reason (free-form message).
  | { type: "needsAttention"; message: string }
  /// "Still waiting" reminder; only matters if nothing else is pending.
  | { type: "idleReminder" }
  /// You're back at it (prompt submitted, tool ran, session ended).
  | { type: "resumed" };

/// Something an AI coding agent told the buddy, normalized across tools.
export interface AgentEvent {
  kind: AgentEventKind;
  /// Display name, e.g. "Claude" or "Codex".
  agent: string;
  /// Unique per agent session; used to track who is waiting.
  session: string;
  /// Folder name of the agent's working directory.
  project: string;
  /// The app the session runs in (an exe path on Windows), when known.
  host?: string;
}

/// Translates one tool's notifications into `AgentEvent`s.
/// To support a new tool, add an adapter and register it in `AgentAdapters.known`.
export interface AgentAdapter {
  /// Name used on the `notify <source> <event>` command line.
  readonly source: string;
  readonly displayName: string;
  event(event: string, payload: Record<string, unknown>): AgentEvent | null;
}

/// Swift `as? String`.
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/// Swift `(path as NSString).lastPathComponent`, but Windows-aware (Windows adaptation 2):
/// accepts both `/` and `\` and ignores trailing separators (`C:\Users\me\Work\my-app\` -> `my-app`).
function lastPathComponent(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed === "") return path === "" ? "" : "/";
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(i + 1);
}

/// Claude Code and Codex share the same hook shape (`session_id`, `cwd`, `hook_event_name`),
/// so one adapter serves both. It also understands Codex's legacy `notify` payload.
export class HookAgentAdapter implements AgentAdapter {
  readonly source: string;
  readonly displayName: string;

  constructor(source: string, displayName: string) {
    this.source = source;
    this.displayName = displayName;
  }

  // port of Agents.swift HookAgentAdapter.event(named:payload:)
  event(event: string, payload: Record<string, unknown>): AgentEvent | null {
    const name = event === "" || event === "auto" ? HookAgentAdapter.inferredEvent(payload) : event;
    const kind = HookAgentAdapter.kind(name, payload);
    if (kind === null) return null;
    return {
      kind,
      agent: this.displayName,
      session: `${this.source}:${HookAgentAdapter.session(payload)}`,
      project: HookAgentAdapter.project(payload),
    };
  }

  static inferredEvent(p: Record<string, unknown>): string {
    return str(p["hook_event_name"]) ?? str(p["type"]) ?? "";
  }

  // port of Agents.swift HookAgentAdapter.kind(for:payload:)
  static kind(name: string, payload: Record<string, unknown>): AgentEventKind | null {
    switch (name) {
      case "done":
      case "Stop":
      case "stop":
      case "agent-turn-complete":
        // Cursor's stop carries a status: "aborted" means you stopped it yourself - you're right there
        return payload["status"] === "aborted" ? { type: "resumed" } : { type: "finished" };
      case "permission":
      case "PermissionRequest":
      case "approval-requested":
        return { type: "needsPermission" };
      case "waiting":
      case "Notification": {
        const message = str(payload["message"]) ?? "";
        const lower = message.toLowerCase();
        if (lower.includes("permission") || lower.includes("approv")) return { type: "needsPermission" };
        if (lower.includes("waiting for your input") || lower.includes("idle")) return { type: "idleReminder" };
        return { type: "needsAttention", message };
      }
      case "dismiss":
      case "UserPromptSubmit":
      case "PostToolUse":
      case "SessionEnd":
        return { type: "resumed" };
      default:
        return null;
    }
  }

  static session(p: Record<string, unknown>): string {
    for (const key of ["session_id", "thread-id", "thread_id", "session", "conversation_id"]) {
      const s = str(p[key]);
      if (s !== undefined && s !== "") return s;
    }
    return "default";
  }

  static project(p: Record<string, unknown>): string {
    const name = str(p["project"]);
    if (name !== undefined && name !== "") return name;
    const cwd = str(p["cwd"]);
    if (cwd !== undefined && cwd !== "") return lastPathComponent(cwd);
    // Cursor: the open folders instead of a cwd
    const roots = p["workspace_roots"];
    if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0] !== "") return lastPathComponent(roots[0]);
    return "";
  }
}

/// Any other tool: `notify <name> done '{"message": "...", "project": "..."}'`.
export class GenericAgentAdapter implements AgentAdapter {
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  /// First character uppercased, rest unchanged (Swift: `prefix(1).uppercased() + dropFirst()`).
  get displayName(): string {
    const chars = Array.from(this.source);
    return (chars[0] ?? "").toUpperCase() + chars.slice(1).join("");
  }

  event(event: string, payload: Record<string, unknown>): AgentEvent | null {
    return new HookAgentAdapter(this.source, this.displayName).event(event, payload);
  }
}

/// Apps that are nothing but an AI agent's UI. Being in front of one means you're looking at the agent.
/// Terminals and editors host far more than the agent, so being in them doesn't count as watching it.
export const AgentApps = {
  /// Windows rules (Windows adaptation 3), case-insensitive, `/` or `\`:
  /// - Claude desktop (MSIX): `...\WindowsApps\Claude_*\...\Claude.exe`
  /// - Claude desktop (Squirrel): `...\AnthropicClaude\app-*\claude.exe`
  /// - OpenAI apps (Codex / ChatGPT): `...\WindowsApps\OpenAI.*`
  /// The Claude Code CLI (`...\claude.exe` elsewhere), terminals and editors are not dedicated.
  isDedicated(exePath: string): boolean {
    // macOS: the helper reports the bundle (`/Applications/Claude.app`). Swift matched the bundle IDs
    // com.anthropic.claudefordesktop / com.openai.codex / com.openai.chat, else an app name starting with
    // claude or codex; by name that is Claude*.app, Codex*.app and ChatGPT.app.
    const mac = /([^/]+)\.app\/?$/i.exec(exePath);
    if (mac !== null) {
      const name = mac[1].toLowerCase();
      return name.startsWith("claude") || name.startsWith("codex") || name === "chatgpt";
    }
    const p = exePath.toLowerCase().replace(/[\\/]+/g, "\\");
    const file = p.slice(p.lastIndexOf("\\") + 1);
    return (
      (p.includes("\\windowsapps\\claude_") && file === "claude.exe") ||
      (p.includes("\\anthropicclaude\\app-") && file === "claude.exe") ||
      p.includes("\\windowsapps\\openai.")
    );
  },
};

/// One on-screen window, as reported by the window server (front to back).
export interface WindowInfo {
  ownerPID: number;
  layer: number;
  /// Defaults to 1 when omitted (Swift init default).
  alpha?: number;
  width: number;
  height: number;
}

export const ScreenWindows = {
  // port of Agents.swift ScreenWindows.frontmostOwner
  /// The app owning the topmost normal window actually on screen. A minimized or hidden app has none, even if
  /// it's still the "active" app.
  frontmostOwner(windows: readonly WindowInfo[]): number | null {
    const w = windows.find((w) => w.layer === 0 && (w.alpha ?? 1) > 0.05 && w.width >= 80 && w.height >= 80);
    return w ? w.ownerPID : null;
  },
};

export const AgentAdapters = {
  known: [
    new HookAgentAdapter("claude", "Claude"),
    new HookAgentAdapter("codex", "Codex"),
    new HookAgentAdapter("cursor", "Cursor"), // Windows addition (Pooria, 2026-10-22)
  ] as readonly AgentAdapter[],

  adapter(source: string): AgentAdapter {
    const key = source.toLowerCase();
    return AgentAdapters.known.find((a) => a.source === key) ?? new GenericAgentAdapter(key === "" ? "agent" : key);
  },

  // port of Agents.swift AgentAdapters.event(from:)
  event(message: InboxMessage): AgentEvent | null {
    const e = AgentAdapters.adapter(message.source).event(message.event, message.payload);
    const host = message.meta["host"];
    if (e !== null && host !== undefined) e.host = host;
    return e;
  },
};
