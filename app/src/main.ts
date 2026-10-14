// Pet window entry (12-windows-plan.md P3): prefs + fonts, the PetController on one transparent canvas, click-through
// input, live preference changes. The Coordinator (agents, queue, tray) arrives in P4/P5.

import { listen } from "@tauri-apps/api/event";
import { PetInput, PressTracker } from "./app/hitTest";
import { PetController } from "./app/pet";
import { Coordinator } from "./app/coordinator";
import { KnockSound } from "./app/sound";
import { rebuildTray } from "./app/trayMenu";
import { invoke } from "@tauri-apps/api/core";
import { Preferences } from "./app/prefs";
import { debugConfig, debugLogger, scheduleTestKnock } from "./app/debug"; // DEBUG (P3)
import { TauriPlatform, ipc } from "./app/platform";
import type { HoverEvent } from "./app/types";
import { loadFonts } from "./render/fonts";

async function main(): Promise<void> {
  const canvas = document.getElementById("pet") as HTMLCanvasElement;
  const dbg = await debugConfig(); // DEBUG (P3)
  const prefs = await Preferences.load();
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
  const tray = (): void => rebuildTray(prefs, coordinator.queue.entries, null);
  coordinator.onQueueChanged = () => tray();
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
      // "checkUpdates" / "installUpdate": P6
    }
  });
  tray();
  await listen<{ texts: string[] }>("inbox", (e) => coordinator.receive(e.payload.texts));

  await pet.start(); // window on the floor + first frame drawn
  await ipc.petReady(); // shows the window (no white flash)
  scheduleTestKnock(dbg, pet, prefs); // DEBUG (P3)
}

void main();
