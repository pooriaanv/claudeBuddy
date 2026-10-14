// port of Sources/BuddyCore/Attention.swift (Mac reference v0.0.9)

import type { AgentEvent, AgentEventKind } from "./agents";

/// An agent session that is waiting for you.
export interface Waiting {
  agent: string;
  project: string;
  kind: AgentEventKind;
  /// You were already looking at the agent when it finished: no knocking, just a menu-bar dot.
  quiet: boolean;
}

/// Swift `Waiting.init` (`quiet` defaults to false).
export function makeWaiting(agent: string, project: string, kind: AgentEventKind, quiet = false): Waiting {
  return { agent, project, kind, quiet };
}

export type AttentionChange =
  /// Someone needs you and you're not looking: come knock.
  | "knock"
  /// The waiting list changed; keep doing what you're doing.
  | "updated"
  /// Someone finished while you were watching it: note it quietly.
  | "quietlyAdded"
  /// Nobody left that needs a knock (quiet ones may remain): go home.
  | "settle"
  /// Nobody is waiting anymore.
  | "empty"
  | "none";

/// Who is waiting, in arrival order. Decides when the buddy should knock, stay quiet or go home.
export class AttentionQueue {
  private items = new Map<string, Waiting>();
  private order: string[] = [];

  get isEmpty(): boolean {
    return this.order.length === 0;
  }

  get entries(): Waiting[] {
    const out: Waiting[] = [];
    for (const key of this.order) {
      const w = this.items.get(key);
      if (w !== undefined) out.push({ ...w });
    }
    return out;
  }

  get needsKnock(): boolean {
    for (const w of this.items.values()) if (!w.quiet) return true;
    return false;
  }

  // port of Attention.swift AttentionQueue.apply
  /// `watching`: the human is looking at this agent's window right now.
  apply(event: AgentEvent, watching = false): AttentionChange {
    const key = event.session;
    switch (event.kind.type) {
      case "resumed":
        if (!this.items.has(key)) return "none";
        this.items.delete(key);
        this.order = this.order.filter((k) => k !== key);
        if (this.order.length === 0) return "empty";
        return this.needsKnock ? "updated" : "settle";
      case "idleReminder": {
        const existing = this.items.get(key);
        if (existing !== undefined) {
          // Finished while you watched, but you've since walked away: knock after all.
          if (!(existing.quiet && !watching)) return "none";
          this.items.set(key, { ...existing, quiet: false });
          return "knock";
        }
        return this.add(key, makeWaiting(event.agent, event.project, { type: "finished" }), watching);
      }
      default:
        return this.add(key, makeWaiting(event.agent, event.project, event.kind), watching);
    }
  }

  /// "Got it": forget the quiet ones (the buddy was clicked).
  clearQuiet(): void {
    for (const [key, w] of [...this.items]) if (w.quiet) this.items.delete(key);
    this.order = this.order.filter((k) => this.items.has(k));
  }

  clear(): void {
    this.items.clear();
    this.order = [];
  }

  private add(key: string, w: Waiting, watching: boolean): AttentionChange {
    w = { ...w, quiet: watching };
    const wasKnocking = this.needsKnock;
    this.items.set(key, w);
    this.order = this.order.filter((k) => k !== key);
    this.order.push(key);
    if (!watching) return "knock";
    return wasKnocking ? "updated" : "quietlyAdded";
  }
}
