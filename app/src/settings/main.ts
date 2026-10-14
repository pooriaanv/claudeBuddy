// port of Sources/ClaudeBuddy/Settings/SettingsView.swift (Mac reference v0.0.9): four tabs, each scrolls on its own;
// RTL when Persian; every change goes to the shared prefs store, which the pet window applies live.

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UpdateState } from "../app/updater";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { Mischief } from "../core/brain";
import type { Language, L10nKey } from "../core/localization";
import { skinNameKey } from "../core/localization";
import { SKIN_IDS } from "../core/pose";
import { Preferences, SIZE_MAX, SIZE_MIN } from "../app/prefs";
import type { KnockStyle } from "../app/prefs";
import { loadFonts } from "../render/fonts";
import { SkinPreview } from "../render/sceneRenderer";

interface HookStatus {
  connected: boolean;
  toolDetected: boolean;
}

let tab = 0;
type UpdateInfo = { state: UpdateState; current: string };
let updateInfo: UpdateInfo | null = null;
let previews: SkinPreview[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function row(...children: (HTMLElement | string)[]): HTMLDivElement {
  const r = el("div", "row");
  for (const c of children) r.append(typeof c === "string" ? el("span", "label", c) : c);
  return r;
}

function toggle(on: boolean, change: (v: boolean) => void): HTMLLabelElement {
  const l = el("label", "switch");
  const i = el("input");
  i.type = "checkbox";
  i.checked = on;
  i.onchange = () => change(i.checked);
  l.append(i, el("span"));
  return l;
}

function segmented<T extends string>(options: [T, string][], value: T, pick: (v: T) => void, cls = "seg"): HTMLDivElement {
  const s = el("div", cls);
  for (const [v, label] of options) {
    const b = el("button", v === value ? "on" : "", label);
    b.onclick = () => pick(v);
    s.append(b);
  }
  return s;
}

function button(label: string, action: () => void, cls = "push"): HTMLButtonElement {
  const b = el("button", cls, label);
  b.onclick = action;
  return b;
}

async function render(prefs: Preferences): Promise<void> {
  const l = prefs.l10n;
  const t = (k: L10nKey): string => l.t(k);
  document.documentElement.dir = l.isRTL ? "rtl" : "ltr";
  document.documentElement.lang = l.isRTL ? "fa" : "en";
  for (const p of previews) p.stop();
  previews = [];

  const tabs = document.getElementById("tabs")!;
  tabs.replaceChildren();
  (["sectionCharacter", "sectionBehavior", "sectionAgents", "sectionUpdates"] as L10nKey[]).forEach((k, i) => {
    tabs.append(button(t(k), () => { tab = i; void render(prefs); }, i === tab ? "on" : ""));
  });

  const main = document.getElementById("content")!;
  main.replaceChildren();
  const section = (): HTMLDivElement => main.appendChild(el("div", "section"));

  if (tab === 0) {
    // characterTab
    const grid = el("div", "grid");
    for (const id of SKIN_IDS) {
      const selected = prefs.skin === id;
      const card = el("button", selected ? "card on" : "card");
      const canvas = el("canvas");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(78 * dpr);
      canvas.height = Math.round(104 * dpr);
      card.append(canvas, el("span", "", t(skinNameKey(id))));
      card.onclick = () => { prefs.skin = id; void render(prefs); };
      grid.append(card);
      const preview = new SkinPreview(canvas, id, selected ? "wave" : "sit");
      preview.start();
      previews.push(preview);
    }
    section().append(grid);
    const slider = el("input");
    slider.type = "range";
    slider.min = String(SIZE_MIN);
    slider.max = String(SIZE_MAX);
    slider.value = String(prefs.size);
    slider.oninput = () => { prefs.size = Number(slider.value); };
    section().append(row(t("size"), slider));
  } else if (tab === 1) {
    // behaviorTab
    const s1 = section();
    s1.append(
      row(t("mischief"), segmented<Mischief>(
        [["calm", t("mischiefCalm")], ["playful", t("mischiefPlayful")], ["naughty", t("mischiefNaughty")]],
        prefs.mischief, (v) => { prefs.mischief = v; void render(prefs); })),
      el("div", "note", t("mischiefHint")),
    );
    const s2 = section();
    const login = await isEnabled().catch(() => false);
    s2.append(
      row(t("sound"), toggle(prefs.soundOn, (v) => { prefs.soundOn = v; }),
        button(t("testKnock"), () => void invoke("settings_action", { id: "testKnock" }))),
      // Windows addition (Pooria, 2026-10-15)
      row(t("knockStyle"), segmented<KnockStyle>(
        [["center", t("knockStyleCenter")], ["inPlace", t("knockStyleInPlace")]],
        prefs.knockStyle, (v) => { prefs.knockStyle = v; void render(prefs); })),
      row(t("quietWhenWatching"), toggle(prefs.quietWhenWatching, (v) => { prefs.quietWhenWatching = v; })),
      el("div", "note", t("quietHint")),
      row(t("launchAtLogin"), toggle(login, (v) => {
        void (v ? enable() : disable()).catch((e) => alert(String(e)));
      })),
    );
    main.append(el("div", "section-title", t("sectionLanguage")));
    section().append(row(segmented<Language>(
      [["system", t("languageSystem")], ["en", "English"], ["fa", "فارسی"]],
      prefs.language, (v) => { prefs.language = v; void render(prefs); }, "seg wide")));
  } else if (tab === 2) {
    // agentsTab
    const s1 = section();
    for (const [agent, name] of [["claude", "Claude Code"], ["codex", "Codex"]] as const) {
      const st = await invoke<HookStatus>("hooks_status", { agentName: agent });
      const info = el("div", "label");
      info.append(el("div", "agent-name", name));
      const status = st.connected
        ? el("div", "agent-status status-ok", `✓  ${t("connected")}`)
        : el("div", "agent-status", st.toolDetected ? t("notConnected") : `${t("notConnected")} · ${t("toolNotFound")}`);
      info.append(status);
      s1.append(row(info, button(st.connected ? t("disconnect") : t("connect"), () => {
        void invoke(st.connected ? "hooks_disconnect" : "hooks_connect", { agentName: agent })
          .catch((e) => alert(String(e)))
          .finally(() => void render(prefs));
      })));
    }
    section().append(el("div", "note", t("codexTrustHint")), el("div", "note mono", t("otherAgentsHint")));
  } else {
    // updatesTab: the state lives in the pet window's Updater (update-state events)
    const v = updateInfo?.current ?? (await getVersion());
    const st = updateInfo?.state ?? { kind: "idle" };
    let status: string;
    switch (st.kind) {
      case "checking": status = t("updateChecking"); break;
      case "upToDate": status = l.format("updateUpToDate", { v }); break;
      case "available": status = l.format("updateAvailable", { v: st.version }); break;
      case "installing": status = t("updateInstalling"); break;
      case "failed": status = l.format("updateFailed", { v: st.message }); break;
      default: status = l.format("updateVersion", { v });
    }
    const label = el("span", st.kind === "failed" ? "label status-err" : "label", status);
    const action = st.kind === "available"
      ? button(t("installNow"), () => void invoke("settings_action", { id: "installUpdate" }), "push primary")
      : button(t("checkNow"), () => void invoke("settings_action", { id: "checkUpdates" }));
    if (st.kind === "checking" || st.kind === "installing") action.disabled = true;
    section().append(row(label, action), row(t("updatesAuto"), toggle(prefs.autoUpdate, (on) => { prefs.autoUpdate = on; })));
  }
}

async function main(): Promise<void> {
  await loadFonts();
  const prefs = await Preferences.load();
  const tabArg = Number(new URLSearchParams(location.search).get("tab") ?? "0");
  if (tabArg >= 0 && tabArg <= 3) tab = tabArg;
  prefs.onChange((key) => { if (key === "language" || key === "skin" || key === "soundOn") void render(prefs); });
  await listen<UpdateInfo>("update-state", (e) => {
    updateInfo = e.payload;
    if (tab === 3) void render(prefs);
  });
  void invoke("settings_action", { id: "updateState" });
  await render(prefs);
}

void main();
