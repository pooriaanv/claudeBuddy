// port of Sources/ClaudeBuddy/Coordinator.swift (Mac reference v0.0.9) — agent events → attention queue → pet.
// The inbox poll lives in Rust (D4: `inbox {texts}` every 0.4 s); updates (P6) and the menu / settings (P5) hook in
// through `onQueueChanged`.

import { invoke } from "@tauri-apps/api/core";
import { AgentApps, AgentAdapters, type AgentEvent } from "../core/agents";
import { AttentionQueue, type Waiting } from "../core/attention";
import { InboxMessage } from "../core/inbox";
import type { PetController } from "./pet";
import type { Preferences } from "./prefs";

interface ForegroundCheck {
  sameExe: boolean;
  minimized: boolean;
  topOwnerIsForeground: boolean;
  idleSecs: number;
}

export class Coordinator {
  readonly queue = new AttentionQueue();
  /// Called after every queue change with the waiting list (tray menu + badge, P5).
  onQueueChanged: ((waiting: readonly Waiting[]) => void) | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prefs: Preferences,
    private readonly pet: PetController,
    private readonly debug: (line: string) => void = () => {},
  ) {
    pet.onDismissRequested = () => this.dismissAll();
    pet.onPetted = () => {
      if (!this.queue.entries.some((w) => w.quiet)) return;
      this.queue.clearQuiet();
      this.queueChanged();
    };
  }

  /// Raw event files from the Rust inbox thread, oldest first. Handled strictly one after another.
  receive(texts: readonly string[]): void {
    for (const text of texts) {
      const event = AgentAdapters.event(InboxMessage.parse(text));
      if (event !== null) this.chain = this.chain.then(() => this.handle(event)).catch(() => {});
    }
  }

  /// Focus.isWatching (D9): the agent's own app, in front, not minimized, owning the top window, touched < 15 s ago.
  private async isWatching(host: string | undefined): Promise<boolean> {
    if (!host || !AgentApps.isDedicated(host)) return false;
    const f = await invoke<ForegroundCheck>("foreground_check", { host });
    return f.sameExe && !f.minimized && f.topOwnerIsForeground && f.idleSecs < 15;
  }

  async handle(event: AgentEvent): Promise<void> {
    const watching = this.prefs.quietWhenWatching && (await this.isWatching(event.host));
    this.debug(`event ${event.kind.type} host=${event.host ?? "-"} watching=${watching}`);
    switch (this.queue.apply(event, watching)) {
      case "knock": {
        const b = this.prefs.l10n.bubble(this.queue.entries);
        this.pet.knock(b.title, b.subtitle);
        break;
      }
      case "updated":
        this.refreshBubble();
        break;
      case "settle":
      case "empty":
        this.pet.goHome();
        break;
      case "quietlyAdded":
      case "none":
        break;
    }
    this.queueChanged();
  }

  dismissAll(): void {
    this.queue.clear();
    this.pet.goHome();
    this.queueChanged();
  }

  /// notify only forwards "dismiss" events while something is waiting; the menu shows who.
  private queueChanged(): void {
    void invoke("set_active_marker", { on: !this.queue.isEmpty });
    this.pet.hint = this.prefs.l10n.hint(this.queue.entries.filter((w) => w.quiet));
    this.onQueueChanged?.(this.queue.entries);
  }

  testKnock(): void {
    void this.handle({
      kind: { type: "finished" },
      agent: "Claude",
      session: `test:${crypto.randomUUID()}`,
      project: "ClaudeBuddy",
    });
  }

  private refreshBubble(): void {
    const b = this.prefs.l10n.bubble(this.queue.entries);
    this.pet.updateBubble(b.title, b.subtitle);
  }

  /// Coordinator.preferencesChanged (pet relayout is wired in main.ts).
  preferencesChanged(): void {
    if (!this.queue.isEmpty) this.refreshBubble();
    this.queueChanged();
  }
}
