import { beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri IPC: `foreground_check` answers what the test sets, `set_active_marker` is recorded.
const ipc = vi.hoisted(() => ({
  foreground: { sameExe: false, minimized: false, topOwnerIsForeground: false, idleSecs: 99 },
  calls: [] as [string, unknown][],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    ipc.calls.push([cmd, args]);
    return cmd === "foreground_check" ? ipc.foreground : undefined;
  }),
}));

import { L10n } from "../core/localization";
import { Coordinator } from "./coordinator";
import type { PetController } from "./pet";
import type { Preferences } from "./prefs";

class FakePet {
  knocks: [string, string][] = [];
  bubbles: [string, string][] = [];
  homes = 0;
  hint: string | null = null;
  onDismissRequested: (() => void) | null = null;
  onPetted: (() => void) | null = null;
  knock(title: string, subtitle: string): void {
    this.knocks.push([title, subtitle]);
  }
  updateBubble(title: string, subtitle: string): void {
    this.bubbles.push([title, subtitle]);
  }
  goHome(): void {
    this.homes++;
  }
}

const CLAUDE_APP = "C:\\Program Files\\WindowsApps\\Claude_1.0.0.0_x64__abc\\app\\Claude.exe";

function event(agent: string, ev: string, session: string, host?: string): string {
  const meta = host === undefined ? "" : `@host ${host}\n`;
  return `${agent} ${ev}\n${meta}${JSON.stringify({ session_id: session, cwd: "C:\\code\\my-app" })}`;
}

function setup(quietWhenWatching = false): { c: Coordinator; pet: FakePet; settle: () => Promise<void> } {
  const pet = new FakePet();
  const prefs = { quietWhenWatching, l10n: new L10n("en") } as unknown as Preferences;
  const c = new Coordinator(prefs, pet as unknown as PetController);
  // Events are handled one after another on a promise chain; let it drain.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { c, pet, settle };
}

beforeEach(() => {
  ipc.calls = [];
  ipc.foreground = { sameExe: false, minimized: false, topOwnerIsForeground: false, idleSecs: 99 };
});

describe("Coordinator", () => {
  it("knocksWhenAnAgentFinishes", async () => {
    const { c, pet, settle } = setup();
    c.receive([event("claude", "done", "s1")]);
    await settle();
    expect(pet.knocks).toHaveLength(1);
    expect(pet.knocks[0][0]).toContain("Claude");
    expect(pet.knocks[0][1]).toContain("my-app");
    expect(ipc.calls).toContainEqual(["set_active_marker", { on: true }]);
  });

  it("goesHomeWhenTheLastSessionResumes", async () => {
    const { c, pet, settle } = setup();
    c.receive([event("claude", "done", "s1"), event("claude", "dismiss", "s1")]);
    await settle();
    expect(pet.knocks).toHaveLength(1);
    expect(pet.homes).toBe(1);
    expect(c.queue.isEmpty).toBe(true);
    expect(ipc.calls[ipc.calls.length - 1]).toEqual(["set_active_marker", { on: false }]);
  });

  it("updatesTheBubbleForASecondSession", async () => {
    const { c, pet, settle } = setup();
    c.receive([event("claude", "done", "s1"), event("codex", "permission", "s2")]);
    await settle();
    expect(c.queue.entries.map((w) => w.agent)).toEqual(["Claude", "Codex"]);
    expect(pet.knocks.length + pet.bubbles.length).toBeGreaterThanOrEqual(2);
  });

  it("staysQuietWhileYouWatchTheAgentsApp", async () => {
    const { c, pet, settle } = setup(true);
    ipc.foreground = { sameExe: true, minimized: false, topOwnerIsForeground: true, idleSecs: 2 };
    c.receive([event("claude", "done", "s1", CLAUDE_APP)]);
    await settle();
    expect(pet.knocks).toHaveLength(0);
    expect(c.queue.entries[0].quiet).toBe(true);
    expect(pet.hint).toContain("my-app");
  });

  it("knocksWhenTheAgentsAppIsNotInFront", async () => {
    const { c, pet, settle } = setup(true);
    ipc.foreground = { sameExe: false, minimized: false, topOwnerIsForeground: false, idleSecs: 2 };
    c.receive([event("claude", "done", "s1", CLAUDE_APP)]);
    await settle();
    expect(pet.knocks).toHaveLength(1);
  });

  it("ignoresUnknownEvents", async () => {
    const { c, pet, settle } = setup();
    c.receive([event("claude", "SomethingNew", "s1")]);
    await settle();
    expect(pet.knocks).toHaveLength(0);
    expect(c.queue.isEmpty).toBe(true);
  });

  it("dismissAllClearsEverythingAndGoesHome", async () => {
    const { c, pet, settle } = setup();
    c.receive([event("claude", "done", "s1"), event("codex", "done", "s2")]);
    await settle();
    pet.onDismissRequested?.();
    expect(c.queue.isEmpty).toBe(true);
    expect(pet.homes).toBe(1);
  });

  it("pettingClearsOnlyTheQuietOnes", async () => {
    const { c, pet, settle } = setup(true);
    ipc.foreground = { sameExe: true, minimized: false, topOwnerIsForeground: true, idleSecs: 2 };
    c.receive([event("claude", "done", "s1", CLAUDE_APP)]);
    await settle();
    ipc.foreground = { sameExe: false, minimized: false, topOwnerIsForeground: false, idleSecs: 2 };
    c.receive([event("codex", "done", "s2")]);
    await settle();
    pet.onPetted?.();
    expect(c.queue.entries.map((w) => w.agent)).toEqual(["Codex"]);
  });

  it("testKnockAndPreferencesChanged", async () => {
    const { c, pet, settle } = setup();
    c.testKnock();
    await settle();
    expect(pet.knocks).toHaveLength(1);
    c.preferencesChanged();
    expect(pet.bubbles).toHaveLength(1);
  });
});
