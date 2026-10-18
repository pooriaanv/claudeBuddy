// port of Tests/BuddyCoreTests/AgentEventTests.swift (Mac reference v0.0.9)

import { describe, expect, it } from "vitest";
import {
  AgentAdapters,
  AgentApps,
  HookAgentAdapter,
  ScreenWindows,
  type AgentEvent,
  type AgentEventKind,
  type WindowInfo,
} from "./agents";
import { AttentionQueue, makeWaiting } from "./attention";
import { InboxMessage } from "./inbox";
import { L10N_KEYS, L10n, skinNameKey } from "./localization";
import { SKIN_IDS } from "./pose";

describe("AgentEventTests", () => {
  it("claudeStopHookMeansFinished", () => {
    const msg = InboxMessage.parse('claude done\n{"session_id":"s1","cwd":"/Users/me/Work/my-app"}');
    const e = AgentAdapters.event(msg);
    expect(e).toEqual({ kind: { type: "finished" }, agent: "Claude", session: "claude:s1", project: "my-app" });
  });

  it("legacySingleWordHeaderIsClaude", () => {
    const msg = InboxMessage.parse('dismiss\n{"session_id":"s1"}');
    expect(msg.source).toBe("claude");
    expect(AgentAdapters.event(msg)?.kind).toEqual({ type: "resumed" });
  });

  it("codexHookEvents", () => {
    const stop = AgentAdapters.event(InboxMessage.parse('codex done\n{"session_id":"x","cwd":"/a/api"}'));
    expect(stop).toEqual({ kind: { type: "finished" }, agent: "Codex", session: "codex:x", project: "api" });
    const perm = AgentAdapters.event(InboxMessage.parse('codex permission\n{"session_id":"x"}'));
    expect(perm?.kind).toEqual({ type: "needsPermission" });
  });

  it("codexLegacyNotifyPayloadIsInferred", () => {
    const msg = InboxMessage.parse('codex auto\n{"type":"agent-turn-complete","thread-id":"t9","cwd":"/p/web"}');
    const e = AgentAdapters.event(msg);
    expect(e).toEqual({ kind: { type: "finished" }, agent: "Codex", session: "codex:t9", project: "web" });
  });

  it("notificationMessagesAreClassified", () => {
    function kind(message: string): AgentEventKind | undefined {
      return new HookAgentAdapter("claude", "Claude").event("waiting", { message })?.kind;
    }
    expect(kind("Claude needs your permission to use Bash")).toEqual({ type: "needsPermission" });
    expect(kind("Claude is waiting for your input")).toEqual({ type: "idleReminder" });
    expect(kind("Build broke")).toEqual({ type: "needsAttention", message: "Build broke" });
  });

  it("unknownToolsGetAGenericAdapter", () => {
    const e = AgentAdapters.event(InboxMessage.parse('gemini done\n{"project":"blog"}'));
    expect(e).toEqual({ kind: { type: "finished" }, agent: "Gemini", session: "gemini:default", project: "blog" });
  });

  it("plainTextPayloadBecomesMessage", () => {
    const msg = InboxMessage.parse("aider waiting\nTests are red");
    expect(AgentAdapters.event(msg)?.kind).toEqual({ type: "needsAttention", message: "Tests are red" });
  });

  it("hostAppComesFromMetadata", () => {
    const msg = InboxMessage.parse(
      'claude done\n@host /Applications/Visual Studio Code.app\n{"session_id":"s"}',
    );
    expect(msg.meta["host"]).toBe("/Applications/Visual Studio Code.app");
    expect(AgentAdapters.event(msg)?.host).toBe("/Applications/Visual Studio Code.app");
    expect(msg.payload["session_id"]).toBe("s");
  });

  it("onlyAgentAppsCountAsWatching", () => {
    // Windows rules (exe paths) instead of Mac bundle IDs.
    expect(
      AgentApps.isDedicated("C:\\Program Files\\WindowsApps\\Claude_2.31226.1.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe"),
    ).toBe(true);
    expect(AgentApps.isDedicated("C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe")).toBe(true);
    expect(AgentApps.isDedicated("C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_x64__abc123\\app\\Codex.exe")).toBe(
      true,
    );
    // case-insensitive, forward slashes
    expect(
      AgentApps.isDedicated("c:/program files/windowsapps/claude_2.31226.1.0_x64__pzs8sxrjxfjjc/app/claude.exe"),
    ).toBe(true);
    // Claude Code CLI, terminals, editors
    expect(AgentApps.isDedicated("C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\2.1.295\\abc\\claude.exe")).toBe(
      false,
    );
    expect(AgentApps.isDedicated("C:\\Users\\me\\.local\\bin\\claude.exe")).toBe(false);
    expect(
      AgentApps.isDedicated("C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.20.0.0_x64__abc\\wt.exe"),
    ).toBe(false);
    expect(AgentApps.isDedicated("C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe")).toBe(false);
    expect(AgentApps.isDedicated("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(false);
    // a Claude_ package folder alone is not enough: the exe must be Claude.exe
    expect(AgentApps.isDedicated("C:\\Program Files\\WindowsApps\\Claude_2.31226.1.0_x64__abc\\app\\other.exe")).toBe(
      false,
    );
    expect(AgentApps.isDedicated("")).toBe(false);
  });

  it("onlyAgentAppsCountAsWatchingOnMac", () => {
    // Mac: the helper reports the bundle path (Swift AgentApps rules, by app name).
    expect(AgentApps.isDedicated("/Applications/Claude.app")).toBe(true);
    expect(AgentApps.isDedicated("/Applications/Codex.app")).toBe(true);
    expect(AgentApps.isDedicated("/Applications/ChatGPT.app")).toBe(true);
    expect(AgentApps.isDedicated("/Users/me/Applications/Claude Beta.app/")).toBe(true);
    expect(AgentApps.isDedicated("/System/Applications/Utilities/Terminal.app")).toBe(false);
    expect(AgentApps.isDedicated("/Applications/Visual Studio Code.app")).toBe(false);
    expect(AgentApps.isDedicated("/Applications/iTerm.app")).toBe(false);
  });

  it("frontmostWindowOwnerSkipsOverlaysAndTinyWindows", () => {
    const windows: WindowInfo[] = [
      { ownerPID: 1, layer: 25, width: 400, height: 400 }, // status-bar level overlay
      { ownerPID: 2, layer: 0, alpha: 0, width: 800, height: 600 }, // invisible
      { ownerPID: 3, layer: 0, width: 20, height: 20 }, // tiny helper window
      { ownerPID: 4, layer: 0, width: 1200, height: 800 }, // the real front window
      { ownerPID: 5, layer: 0, width: 1200, height: 800 },
    ];
    expect(ScreenWindows.frontmostOwner(windows)).toBe(4);
    expect(ScreenWindows.frontmostOwner([])).toBeNull(); // e.g. the only app is minimized
  });

  it("unknownEventsAreIgnored", () => {
    expect(AgentAdapters.event(InboxMessage.parse("claude PreCompact\n{}"))).toBeNull();
  });

  // Windows additions

  it("crlfEventFileParsesLikeLF", () => {
    const lf = 'claude done\n@host C:\\Program Files\\Code.exe\n{"session_id":"s1","cwd":"/Users/me/Work/my-app"}\n';
    const crlf = lf.replace(/\n/g, "\r\n");
    const a = InboxMessage.parse(lf);
    const b = InboxMessage.parse(crlf);
    expect(b).toEqual(a);
    expect(b.source).toBe("claude");
    expect(b.event).toBe("done");
    expect(b.meta["host"]).toBe("C:\\Program Files\\Code.exe");
    expect(AgentAdapters.event(b)).toEqual({
      kind: { type: "finished" },
      agent: "Claude",
      session: "claude:s1",
      project: "my-app",
      host: "C:\\Program Files\\Code.exe",
    });
    // plain-text body and bare header with CRLF too
    expect(InboxMessage.parse("aider waiting\r\nTests are red\r\n").payload).toEqual({ message: "Tests are red" });
    expect(InboxMessage.parse("dismiss\r\n").event).toBe("dismiss");
  });

  it("backslashCwdUsesLastComponent", () => {
    function project(cwd: string): string | undefined {
      return AgentAdapters.event({ source: "claude", event: "done", payload: { cwd }, meta: {} })?.project;
    }
    expect(project("C:\\Users\\me\\Work\\my-app")).toBe("my-app");
    expect(project("C:\\Users\\me\\Work\\my-app\\")).toBe("my-app");
    expect(project("/Users/me/Work/my-app/")).toBe("my-app");
    expect(project("C:/Users/me/Work/my-app")).toBe("my-app");
    expect(project("C:\\Users\\me/Work\\my-app")).toBe("my-app");
    const msg = InboxMessage.parse('claude done\n{"session_id":"s","cwd":"C:\\\\Users\\\\me\\\\Work\\\\my-app\\\\"}');
    expect(AgentAdapters.event(msg)?.project).toBe("my-app");
  });

  it("nonObjectJSONBodyBecomesMessage", () => {
    expect(InboxMessage.parse("claude waiting\n[1,2]").payload).toEqual({ message: "[1,2]" });
    expect(InboxMessage.parse("claude waiting\n42").payload).toEqual({ message: "42" });
    expect(InboxMessage.parse("claude waiting\n").payload).toEqual({});
  });
});

describe("AttentionQueueTests", () => {
  function event(kind: AgentEventKind, session = "claude:a"): AgentEvent {
    return { kind, agent: "Claude", session, project: "p" };
  }

  it("knockThenResumeGoesHome", () => {
    const q = new AttentionQueue();
    expect(q.apply(event({ type: "finished" }))).toBe("knock");
    expect(q.apply(event({ type: "resumed" }))).toBe("empty");
    expect(q.isEmpty).toBe(true);
  });

  it("resumeForUnknownSessionDoesNothing", () => {
    const q = new AttentionQueue();
    expect(q.apply(event({ type: "resumed" }))).toBe("none");
  });

  it("multipleSessionsStayUntilAllResume", () => {
    const q = new AttentionQueue();
    q.apply(event({ type: "finished" }, "claude:a"));
    q.apply(event({ type: "needsPermission" }, "codex:b"));
    expect(q.entries.length).toBe(2);
    expect(q.apply(event({ type: "resumed" }, "claude:a"))).toBe("updated");
    expect(q.apply(event({ type: "resumed" }, "codex:b"))).toBe("empty");
  });

  it("finishingWhileWatchingStaysQuiet", () => {
    const q = new AttentionQueue();
    expect(q.apply(event({ type: "finished" }), true)).toBe("quietlyAdded");
    expect(q.needsKnock).toBe(false);
    expect(q.apply(event({ type: "resumed" }))).toBe("empty");
  });

  it("walkingAwayFromAQuietSessionKnocksOnTheReminder", () => {
    const q = new AttentionQueue();
    q.apply(event({ type: "finished" }), true);
    expect(q.apply(event({ type: "idleReminder" }), true)).toBe("none");
    expect(q.apply(event({ type: "idleReminder" }), false)).toBe("knock");
    expect(q.needsKnock).toBe(true);
  });

  it("quietSessionsDontKeepTheBuddyKnocking", () => {
    const q = new AttentionQueue();
    q.apply(event({ type: "finished" }, "claude:a"), true);
    expect(q.apply(event({ type: "finished" }, "codex:b"))).toBe("knock");
    expect(q.apply(event({ type: "resumed" }, "codex:b"))).toBe("settle");
    expect(q.entries.length).toBe(1);
  });

  it("clickingClearsOnlyQuietOnes", () => {
    const q = new AttentionQueue();
    q.apply(event({ type: "finished" }, "claude:a"), true);
    q.apply(event({ type: "finished" }, "codex:b"));
    q.clearQuiet();
    expect(q.entries.map((e) => e.agent)).toEqual(["Claude"]);
    expect(q.needsKnock).toBe(true);
  });

  it("hintText", () => {
    const a = makeWaiting("Claude", "api", { type: "finished" }, true);
    const b = makeWaiting("Codex", "", { type: "finished" }, true);
    expect(new L10n("en", []).hint([a])).toBe("✓ api");
    expect(new L10n("fa", []).hint([a, b, b])).toBe("✓ api +۲");
    expect(new L10n("en", []).hint([b])).toBe("✓ Codex");
    expect(new L10n("en", []).hint([])).toBeNull();
  });

  it("idleReminderDoesNotOverwritePermission", () => {
    const q = new AttentionQueue();
    q.apply(event({ type: "needsPermission" }));
    expect(q.apply(event({ type: "idleReminder" }))).toBe("none");
    expect(q.entries[0]?.kind).toEqual({ type: "needsPermission" });
  });
});

describe("LocalizationTests", () => {
  it("everyKeyHasBothLanguages", () => {
    for (const key of L10N_KEYS) {
      const pair = L10n.table[key];
      expect(pair, `missing ${key}`).toBeDefined();
      expect(pair.en.length > 0 && pair.fa.length > 0, `empty ${key}`).toBe(true);
    }
    expect(Object.keys(L10n.table).length).toBe(L10N_KEYS.length);
    for (const id of SKIN_IDS) expect(L10N_KEYS).toContain(skinNameKey(id));
  });

  it("systemLanguageFollowsPreferredLanguages", () => {
    expect(new L10n("system", ["fa-IR", "en"]).language).toBe("fa");
    expect(new L10n("system", ["en-US", "fa-US"]).language).toBe("en");
    expect(new L10n("fa", ["en-US"]).isRTL).toBe(true);
  });

  it("bubbleTexts", () => {
    const one = [makeWaiting("Codex", "api", { type: "finished" })];
    expect(new L10n("en", []).bubble(one)).toEqual({ title: "Codex is done! ✨", subtitle: "waiting for you 👀 · api" });
    const two = [...one, makeWaiting("Claude", "web", { type: "needsPermission" })];
    expect(new L10n("fa", []).bubble(two).title).toBe("۲ تا ایجنت منتظرتن! 👀");
  });

  it("platformWording", () => {
    const saved = L10n.platform;
    try {
      L10n.platform = "mac";
      expect(new L10n("fa", []).t("launchAtLogin")).toBe("با روشن شدن مک باز شه");
      expect(new L10n("en", []).t("toolNotFound")).toBe("not found on this Mac");
      expect(new L10n("en", []).t("otherAgentsHint")).toContain("~/.claude-buddy/buddy-notify <name> done");
      L10n.platform = "windows";
      expect(new L10n("fa", []).t("launchAtLogin")).toBe("با روشن شدن ویندوز باز شه");
      expect(new L10n("en", []).t("toolNotFound")).toBe("not found on this PC");
      expect(new L10n("en", []).t("otherAgentsHint")).toContain("buddy-notify.exe");
    } finally {
      L10n.platform = saved;
    }
  });
});
