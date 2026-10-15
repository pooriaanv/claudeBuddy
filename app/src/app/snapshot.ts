// port of Sources/ClaudeBuddy/Snapshot.swift (Mac reference v0.0.9) -- 12-windows-plan.md D13.
//
// Loaded by the hidden "snapshot" webview that `ClaudeBuddy.exe --snapshot <out.png> [en|fa] [mode] [fontVariant]`
// creates (src-tauri/src/snapshot.rs): `snapshot.html?lang=en&mode=sheet&font=nunito`.
//   mode=sheet  every skin in every pose (12 shots x 7 skins, 180x240 cells at DPR 1) + the menu-bar faces strip
//   mode=icon   the 1024x1024 app icon
// The PNG goes back through the `snapshot_done` command (base64); Rust writes the file and exits.

import { invoke } from "@tauri-apps/api/core";
import { AnimationInput, Animator, Knocking } from "../core/animation";
import type { Activity } from "../core/brain";
import { makeWaiting } from "../core/attention";
import { L10n } from "../core/localization";
import type { Language } from "../core/localization";
import { Bubble, SKIN_IDS } from "../core/pose";
import type { SkinID } from "../core/pose";
import { drawIcon, drawMenuBarFace } from "../render/appIcon";
import { loadFonts } from "../render/fonts";
import { WHITE, rgb } from "../render/paint";
import { IN_PLACE_BUBBLE_SCALE, draw } from "../render/sceneRenderer";
import { skinFor } from "../render/skins/catalog";
import { drawBlockAt, measure, setFontVariant } from "../render/text";
import type { FontVariant, TextFont } from "../render/text";

interface Shot {
  label: string;
  input: AnimationInput;
  bubble: Bubble | null;
  hint: string | null;
}

// port of Snapshot.shots
function shots(l10n: L10n): Shot[] {
  const make = (
    label: string,
    activity: Activity,
    opts: { e?: number; t?: number } = {},
    edit: (i: AnimationInput) => void = () => {},
  ): Shot => {
    const i = new AnimationInput(opts.t ?? 10.05);
    i.activity = activity;
    i.activityElapsed = opts.e ?? 0.3;
    edit(i);
    return { label, input: i, bubble: null, hint: null };
  };
  const { title, subtitle } = l10n.bubble([makeWaiting("Claude", "my-app", { type: "finished" })]);
  const knock = make("knock", "sit", {}, (i) => {
    i.mode = "alert";
    i.knockHits = Knocking.schedule(1.0);
    i.alertElapsed = 1.27;
  });
  knock.bubble = new Bubble(title, subtitle, l10n.isRTL, 1);
  const turning = make("turning", "sit", {}, (i) => {
    i.mode = "approaching";
    i.alertElapsed = 0.22;
  });
  const sit = make("sit + hint", "sit", { t: 11.0 });
  sit.hint = l10n.hint([makeWaiting("Claude", "my-app", { type: "finished" }, true)]);
  return [
    sit,
    make("walk →", "walk", { e: 0.25 }, (i) => {
      i.direction = 1;
    }),
    make("walk ←", "walk", { e: 0.42 }, (i) => {
      i.direction = -1;
    }),
    make("jump", "jump", { e: 0.3 }),
    make("dance", "dance", { e: 0.3 }),
    make("wave", "wave", { e: 0.8 }),
    make("yawn", "yawn", { e: 1.1 }),
    make("sleep", "sleep", { e: 3 }),
    make("carried", "dangle", {}, (i) => {
      i.swing = 12;
    }),
    make("pat", "sit", { t: 11.0 }, (i) => {
      i.heartAges = [0.45];
    }),
    turning,
    knock,
  ];
}

const CELL_W = 180;
const CELL_H = 240;
/// 240 (cell) + 14 (11 px label line) + 6 (bottom padding) = the reference sheet's 260 px per row (2160x1820 = 12x7).
const LABEL_H = 14;
const PAD_BOTTOM = 6;
const ROW_H = CELL_H + LABEL_H + PAD_BOTTOM;

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d context unavailable");
  return [canvas, ctx];
}

/// `.font(.system(size: 11))`: system font, not rounded.
const LABEL_FONT: TextFont = { size: 11, weight: "regular", design: "system" };

function label(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, alpha: number): void {
  drawBlockAt(ctx, measure(text, LABEL_FONT, Infinity), cx, top + LABEL_H / 2, WHITE.opacity(alpha));
}

// port of Snapshot.render (the sheet)
function renderSheet(l10n: L10n): HTMLCanvasElement {
  const list = shots(l10n);
  const [sheet, ctx] = newCanvas(CELL_W * list.length, ROW_H * SKIN_IDS.length);
  ctx.fillStyle = "rgb(84, 84, 84)"; // Color(white: 0.33)
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  SKIN_IDS.forEach((skinId, row) => {
    list.forEach((shot, col) => {
      const x = col * CELL_W;
      const y = row * ROW_H;
      // Straight onto the one sheet canvas, no clip (a SwiftUI `Canvas` does not clip: a long tail or an ear tip
      // overflows into the label line / the next cell), in the Swift stack order: cell, its label, next cell, ...
      let skin;
      try {
        skin = skinFor(skinId);
      } catch (e) {
        console.error(`${skinId} · ${shot.label}: ${String(e)}`);
        skin = null;
      }
      if (skin === null) {
        label(ctx, "not ported", x + CELL_W / 2, y + CELL_H / 2 - LABEL_H / 2, 0.5);
      } else {
        const scene = Animator.scene(shot.input);
        scene.bubble = shot.bubble;
        scene.hint = shot.hint;
        scene.knockText = l10n.t("knockWord");
        ctx.save();
        ctx.translate(x, y);
        draw(ctx, { width: CELL_W, height: CELL_H }, scene, skin);
        ctx.restore();
      }
      label(ctx, `${skinId} · ${shot.label}`, x + CELL_W / 2, y + CELL_H, 0.7);
    });
  });
  return sheet;
}

/// The menu-bar faces strip at scale 2 (Swift `ImageRenderer` scale 2): per skin the 18 pt face enlarged to 72 pt and
/// at its natural size, HStack spacing 16, padding 12, background white 0.92.
function renderMenuBar(): HTMLCanvasElement {
  const width = 12 * 2 + SKIN_IDS.length * (72 + 18) + (SKIN_IDS.length * 2 - 1) * 16;
  const height = 12 * 2 + 72;
  const [strip, ctx] = newCanvas(width * 2, height * 2);
  ctx.scale(2, 2);
  ctx.fillStyle = rgb(0.92, 0.92, 0.92).css;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  let x = 12;
  for (const skinId of SKIN_IDS) {
    try {
      // `menuBarImage` is an 18 pt image rendered at scale 2 = 36 px.
      const [face, fctx] = newCanvas(36, 36);
      drawMenuBarFace(fctx, skinId, false, 36);
      ctx.drawImage(face, x, 12, 72, 72);
      ctx.drawImage(face, x + 72 + 16, 12 + (72 - 18) / 2, 18, 18);
    } catch (e) {
      console.error(`menu-bar face ${skinId}: ${String(e)}`);
    }
    x += 72 + 16 + 18 + 16;
  }
  return strip;
}

function renderIcon(): HTMLCanvasElement {
  const [icon, ctx] = newCanvas(1024, 1024);
  try {
    drawIcon(ctx, 1024);
  } catch (e) {
    console.error(`app icon: ${String(e)}`);
  }
  return icon;
}

function pngBase64(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL("image/png");
  return url.slice(url.indexOf(",") + 1);
}

/// Windows addition preview: the in-place knock at real desktop size (150 x 200), bubble x HINT_SCALE.
function renderInPlace(): HTMLCanvasElement {
  const cells: [SkinID, Language][] = [["buddy", "en"], ["buddy", "fa"], ["kitty", "en"], ["ninja", "en"]];
  const [sheet, ctx] = newCanvas(170 * cells.length, 290);
  ctx.fillStyle = "rgb(84, 84, 84)";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  cells.forEach(([skinId, lang], i) => {
    const l10n = new L10n(lang);
    const input = new AnimationInput(10.05);
    input.mode = "alert";
    input.knockHits = Knocking.schedule(1.0);
    input.alertElapsed = 1.27;
    const scene = Animator.scene(input);
    const b = l10n.bubble([makeWaiting("Claude", "my-app", { type: "finished" })]);
    scene.bubble = new Bubble(b.title, b.subtitle, l10n.isRTL, 1);
    scene.bubble.scale = IN_PLACE_BUBBLE_SCALE;
    scene.knockText = l10n.t("knockWord");
    ctx.save();
    ctx.translate(10 + i * 170, 10);
    draw(ctx, { width: 150, height: 260 }, scene, skinFor(skinId));
    ctx.restore();
    label(ctx, `${skinId} · ${lang}`, 10 + i * 170 + 75, 210, 0.7);
  });
  return sheet;
}

/// Windows additions preview (Pooria, 2026-10-15): a few frames of each new activity, one row per character/move.
function renderMoves(): HTMLCanvasElement {
  type Row = { skin: SkinID; activity: Activity; times: number[] };
  const rows: Row[] = [
    { skin: "ninja", activity: "kata", times: [0.5, 1.0, 1.6, 2.3, 2.8, 3.3, 4.7] },
    { skin: "cyberNinja", activity: "kick", times: [0.4, 0.8, 1.0, 1.35, 1.6, 1.9, 2.5] },
    { skin: "ninja", activity: "shuriken", times: [0.4, 0.75, 0.9, 1.2, 1.6, 1.75, 2.1] },
    { skin: "cyberNinja", activity: "sword", times: [0.5, 0.9, 1.45, 2.5, 2.9, 3.4, 4.4] },
  ];
  const cols = Math.max(...rows.map((r) => r.times.length));
  const [sheet, ctx] = newCanvas(CELL_W * cols, ROW_H * rows.length);
  ctx.fillStyle = "rgb(84, 84, 84)";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  rows.forEach((r, row) => {
    r.times.forEach((e, col) => {
      const input = new AnimationInput(10.05 + e);
      input.activity = r.activity;
      input.activityElapsed = e;
      const scene = Animator.scene(input);
      ctx.save();
      ctx.translate(col * CELL_W, row * ROW_H);
      draw(ctx, { width: CELL_W, height: CELL_H }, scene, skinFor(r.skin));
      ctx.restore();
      label(ctx, `${r.skin} · ${r.activity} ${e}s`, col * CELL_W + CELL_W / 2, row * ROW_H + CELL_H, 0.7);
    });
  });
  return sheet;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const lang: Language = params.get("lang") === "fa" ? "fa" : "en";
  const mode = params.get("mode") ?? "sheet";
  const variant: FontVariant = params.get("font") === "segoe" ? "segoe" : "nunito";
  setFontVariant(variant);
  await loadFonts();
  const l10n = new L10n(lang);
  if (mode === "inplace") {
    await invoke("snapshot_done", { pngBase64: pngBase64(renderInPlace()), menubarBase64: null });
  } else if (mode === "moves") {
    await invoke("snapshot_done", { pngBase64: pngBase64(renderMoves()), menubarBase64: null });
  } else if (mode === "icon") {
    await invoke("snapshot_done", { pngBase64: pngBase64(renderIcon()), menubarBase64: null });
  } else {
    const sheet = pngBase64(renderSheet(l10n));
    await invoke("snapshot_done", { pngBase64: sheet, menubarBase64: pngBase64(renderMenuBar()) });
  }
}

main().catch((e: unknown) => {
  void invoke("snapshot_error", { message: String(e) });
});
