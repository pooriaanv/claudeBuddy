// "What's new" window (Windows addition, Pooria 2026-10-22): after an update, the CHANGELOG sections the user has not
// seen yet (`?since=<previous version>`); from the tray, the current version's. The notes are English; the frame
// follows the app language.

import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import changelog from "../../../CHANGELOG.md?raw";
import { Preferences } from "../app/prefs";
import { parseChangelog, renderNotes, unseenSections } from "../core/changelog";
import { drawMenuBarFace } from "../render/appIcon";

async function main(): Promise<void> {
  const prefs = await Preferences.load();
  const l = prefs.l10n;
  document.documentElement.lang = l.language;
  document.documentElement.dir = l.isRTL ? "rtl" : "ltr";
  const version = await getVersion();
  const since = new URLSearchParams(location.search).get("since") || null;

  const head = document.getElementById("head")!;
  const face = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  face.width = face.height = Math.round(44 * dpr);
  const ctx = face.getContext("2d");
  if (ctx !== null) drawMenuBarFace(ctx, prefs.skin, false, face.width);
  const titles = document.createElement("div");
  const h1 = document.createElement("h1");
  h1.textContent = l.format("whatsNewTitle", { v: version });
  titles.append(h1);
  if (since !== null) {
    const s = document.createElement("div");
    s.className = "since";
    s.textContent = l.format("whatsNewSince", { v: since });
    titles.append(s);
  }
  head.append(face, titles);

  const all = parseChangelog(changelog);
  let sections = unseenSections(all, since, version);
  if (sections.length === 0) sections = all.slice(0, 1);
  const notes = document.getElementById("notes")!;
  for (const s of sections) {
    const box = document.createElement("section");
    const h2 = document.createElement("h2");
    h2.textContent = s.version;
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = s.date;
    h2.append(date);
    const body = document.createElement("div");
    body.innerHTML = renderNotes(s.body); // escaped by renderNotes
    box.append(h2, body);
    notes.append(box);
  }

  const ok = document.getElementById("ok") as HTMLButtonElement;
  ok.textContent = l.t("whatsNewGotIt");
  ok.onclick = () => void getCurrentWindow().close();
  ok.focus();
}

void main();
