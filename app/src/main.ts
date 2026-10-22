// Pet window entry (12-windows-plan.md P3): prefs + fonts, the PetController on one transparent canvas, click-through
// input, live preference changes. The Coordinator (agents, queue, tray) arrives in P4/P5.

import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import { PetInput, PressTracker } from "./app/hitTest";
import { PetController } from "./app/pet";
import { Coordinator } from "./app/coordinator";
import { KnockSound } from "./app/sound";
import { rebuildTray } from "./app/trayMenu";
import { Updater } from "./app/updater";
import { invoke } from "@tauri-apps/api/core";
import { Preferences } from "./app/prefs";
import { debugConfig, debugLogger } from "./app/debug";
import { TauriPlatform, ipc } from "./app/platform";
import type { HoverEvent } from "./app/types";
import { loadFonts } from "./render/fonts";

async function main(): Promise<void> {
  const canvas = document.getElementById("pet") as HTMLCanvasElement;
  const dbg = await debugConfig();
  const prefs = await Preferences.load();
  const appVersion = await getVersion();
  await loadFonts(); // canvas text never waits for a font: the bubble / hint need the faces before the first frame
  const monitors = await ipc.monitors();

  const platform = new TauriPlatform(canvas);
  const pet = new PetController({ prefs, platform, monitors, log: debugLogger(dbg) });
  const press = new PressTracker(pet);
  const input = new PetInput(canvas, press, { pointerState: ipc.pointerState, setClickThrough: ipc.setClickThrough });
  pet.onPointerState = (ps, sampledAt) => input.update(ps, sampledAt);
  input.attach();

  await listen<HoverEvent>("pet-hover", (e) => input.onHover(e.payload));
  await listen("screens-changed", () => {
    void ipc.monitors().then((list) => pet.screensChanged(list));
  });
  pet.sound = new KnockSound();
  const coordinator = new Coordinator(prefs, pet, debugLogger(dbg) ?? undefined);
  // Coordinator.preferencesChanged: skin, size, language ... apply live.
  const updater = new Updater();
  await updater.init();
  const tray = (): void => rebuildTray(prefs, coordinator.queue.entries, updater.availableVersion);
  // Coordinator.installUpdateIfAllowed: only when allowed, nothing is waiting and the buddy is just hanging out.
  const installIfAllowed = (): void => {
    if (prefs.autoUpdate && updater.availableVersion !== null && coordinator.queue.isEmpty && pet.mode === "idle") {
      void updater.install();
    }
  };
  const broadcastUpdate = (): void => void emit("update-state", { state: updater.state, current: updater.current });
  updater.onChange = () => {
    tray();
    broadcastUpdate();
    installIfAllowed();
  };
  coordinator.onQueueChanged = () => {
    tray();
    installIfAllowed();
  };
  setTimeout(() => void updater.checkIfDue(), 10_000);
  setInterval(() => void updater.checkIfDue(), 3600_000);
  prefs.onChange(() => {
    pet.relayout();
    coordinator.preferencesChanged();
    void invoke("set_settings_title", { title: prefs.l10n.t("settingsTitle") });
  });
  // Tray menu + settings buttons (StatusMenu actions).
  await listen<{ id: string }>("tray-action", (e) => {
    switch (e.payload.id) {
      case "settings":
        void invoke("open_settings", { title: prefs.l10n.t("settingsTitle") });
        break;
      case "whatsNew":
        void invoke("open_whats_new", { title: prefs.l10n.format("whatsNewTitle", { v: appVersion }), since: null });
        break;
      case "testKnock":
        coordinator.testKnock();
        break;
      case "sendHome":
        coordinator.dismissAll();
        break;
      case "mute":
        prefs.soundOn = !prefs.soundOn;
        tray();
        break;
      case "quit":
        void invoke("quit");
        break;
      case "checkUpdates":
        void updater.check();
        break;
      case "installUpdate":
        void updater.install();
        break;
      case "updateState": // the settings window asks for the current state
        broadcastUpdate();
        break;
    }
  });
  tray();
  await listen<{ texts: string[] }>("inbox", (e) => coordinator.receive(e.payload.texts));

  await pet.start(); // window on the floor + first frame drawn
  await ipc.petReady(); // shows the window (no white flash)

  // Windows addition (Pooria, 2026-10-22): after an update, show what changed (not after a fresh install).
  const seen = prefs.lastSeenVersion;
  if (seen !== appVersion) {
    if (!prefs.isFirstRun) {
      const title = prefs.l10n.format("whatsNewTitle", { v: appVersion });
      setTimeout(() => void invoke("open_whats_new", { title, since: seen }), 1500);
    }
    prefs.lastSeenVersion = appVersion;
  }
}

void main();
