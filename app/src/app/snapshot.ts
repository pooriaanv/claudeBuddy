// port of Sources/ClaudeBuddy/Snapshot.swift (Mac reference v0.0.9) -- 12-windows-plan.md D13.
//
// Loaded by the hidden "snapshot" webview that `ClaudeBuddy.exe --snapshot <out.png> [en|fa] [mode] [fontVariant]`
// creates (src-tauri/src/snapshot.rs): `snapshot.html?lang=en&mode=sheet&font=nunito`.
//   mode=sheet  every skin in every pose (12 shots x 8 skins, 180x240 cells at DPR 1) + the menu-bar faces strip
//   mode=icon   the 1024x1024 app icon
// The PNG goes back through the `snapshot_done` command (base64); Rust writes the file and exits.

import { invoke } from "@tauri-apps/api/core";
import { AnimationInput, Animator, Knocking } from "../core/animation";
import type { HitKind } from "../core/animation";
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
import { drawBlockAt, drawTextAt, measure, setFontVariant } from "../render/text";
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

/// Tweet image (1600 x 900): two desktops side by side - the Ninja knocking for Codex, Byte knocking for Claude.
/// `inPlace`: the "right where it is" knock style (on the taskbar, in front of the window, bigger bubble).
function renderTweet(inPlace: boolean): HTMLCanvasElement {
  const W = 1600;
  const H = 900;
  const [img, ctx] = newCanvas(W, H);
  const l10n = new L10n("en");
  const rr = (x: number, y: number, w: number, h: number, r: number): Path2D => {
    const p = new Path2D();
    p.roundRect(x, y, w, h, r);
    return p;
  };
  type Panel = { skin: SkinID; agent: string; kind: { type: "finished" } | { type: "needsPermission" }; top: string; bottom: string };
  const panels: Panel[] = [
    { skin: "ninja", agent: "Codex", kind: { type: "needsPermission" }, top: "#1f2a44", bottom: "#3a2f5c" },
    { skin: "byte", agent: "Claude", kind: { type: "finished" }, top: "#3b2a2a", bottom: "#6b3b2e" },
  ];
  panels.forEach((pn, i) => {
    const x0 = i * (W / 2);
    const pw = W / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, pw, H);
    ctx.clip();
    // wallpaper
    const bg = ctx.createLinearGradient(x0, 0, x0 + pw, H);
    bg.addColorStop(0, pn.top);
    bg.addColorStop(1, pn.bottom);
    ctx.fillStyle = bg;
    ctx.fillRect(x0, 0, pw, H);
    const glow = ctx.createRadialGradient(x0 + pw * 0.7, 160, 20, x0 + pw * 0.7, 160, 520);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.10)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x0, 0, pw, H);
    // a generic code editor window (no product UI): title bar, sidebar, code lines
    const wx = x0 + 60;
    const wy = 70;
    const ww = pw - 120;
    const wh = inPlace ? 740 : 600;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = "#1c1d24";
    ctx.fill(rr(wx, wy, ww, wh, 14));
    ctx.restore();
    ctx.save();
    ctx.clip(rr(wx, wy, ww, wh, 14));
    ctx.fillStyle = "#26272f";
    ctx.fillRect(wx, wy, ww, 38);
    ["#ff6b5e", "#ffc24b", "#4fd26b"].forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(wx + 24 + k * 22, wy + 19, 6.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#202129";
    ctx.fillRect(wx, wy + 38, 150, wh - 38);
    for (let k = 0; k < 9; k++) {
      ctx.fillStyle = k === 2 ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.07)";
      ctx.fillRect(wx + 18, wy + 62 + k * 30, 70 + ((k * 37) % 50), 9);
    }
    const colors = ["#c792ea", "#82aaff", "#c3e88d", "#f78c6c", "#89ddff", "#9aa0b4"];
    let seed = 7 + i * 13;
    for (let k = 0; k < 16; k++) {
      let cx = wx + 180 + ((k * 3) % 4 === 0 ? 0 : 28) + (k % 5 === 4 ? 56 : 0);
      for (let s = 0; s < 3; s++) {
        seed = (seed * 9301 + 49297) % 233280;
        const len = 30 + (seed % 90);
        if (cx + len > wx + ww - 20) break;
        ctx.fillStyle = colors[(seed >> 3) % colors.length];
        ctx.globalAlpha = 0.75;
        ctx.fillRect(cx, wy + 64 + k * 32, len, 10);
        cx += len + 12;
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // taskbar
    ctx.fillStyle = "rgba(20, 20, 26, 0.82)";
    ctx.fillRect(x0, H - 56, pw, 56);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = k === 2 ? "rgba(255, 255, 255, 0.34)" : "rgba(255, 255, 255, 0.16)";
      ctx.fill(rr(x0 + pw / 2 - 150 + k * 52, H - 44, 32, 32, 8));
    }
    // the buddy knocking on the glass
    const input = new AnimationInput(10.05);
    input.mode = "alert";
    input.knockHits = Knocking.schedule(1.0);
    input.alertElapsed = 1.27;
    const scene = Animator.scene(input);
    const b = l10n.bubble([makeWaiting(pn.agent, "my-app", pn.kind)]);
    scene.bubble = new Bubble(b.title, b.subtitle, false, 1);
    scene.knockText = l10n.t("knockWord");
    if (inPlace) {
      // real window size (150 x 200, grown 30 % upward for the bubble), enlarged 1.7x so it reads in a tweet
      scene.bubble.scale = IN_PLACE_BUBBLE_SCALE;
      const k = 1.7;
      ctx.translate(x0 + pw * 0.66 - (150 * k) / 2, H - 56 - 252 * k);
      ctx.scale(k, k);
      draw(ctx, { width: 150, height: 260 }, scene, skinFor(pn.skin));
    } else {
      const scale = 2.9;
      ctx.translate(x0 + pw / 2 - (CELL_W * scale) / 2 + 20, H - 40 - CELL_H * scale);
      ctx.scale(scale, scale);
      draw(ctx, { width: CELL_W, height: CELL_H }, scene, skinFor(pn.skin));
    }
    ctx.restore();
  });
  // divider
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(W / 2 - 2, 0, 4, H);
  return img;
}

/// Preview of the impatient knock (Pooria, 2026-10-21): a few frames from knock to cracked glass, two characters.
function renderImpatient(l10n: L10n): HTMLCanvasElement {
  const plan = Knocking.impatient(1.0);
  const at = (kind: HitKind, n = 0): number => plan.hits.filter((_, i) => plan.kinds[i] === kind)[n];
  const frames: [string, number, number][] = [
    ["knock", at("knock") + 0.03, -1],
    ["BOOM (stomp)", at("stomp") + 0.03, -1],
    ["CLAP!", at("clap") + 0.03, -1],
    ["BANG! (slam)", at("slam", 3) + 0.03, -1],
    ["crack 0.1 s", plan.crackAt + 0.1, 0.1],
    ["crack 0.6 s", plan.crackAt + 0.6, 0.6],
    ["cracked, 5 s", plan.crackAt + 5, 5],
  ];
  const skins: SkinID[] = ["buddy", "ninja"];
  const W = 240;
  const H = 320;
  const [sheet, ctx] = newCanvas(W * frames.length, (H + 20) * skins.length);
  ctx.fillStyle = "rgb(84, 84, 84)";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const b = l10n.bubble([makeWaiting("Claude", "my-app", { type: "finished" })]);
  skins.forEach((skin, row) => {
    frames.forEach(([name, e, crack], col) => {
      const input = new AnimationInput(10.05 + e);
      input.mode = "alert";
      input.alertElapsed = e;
      input.knockHits = plan.hits;
      input.knockKinds = plan.kinds;
      input.crackAge = crack;
      const scene = Animator.scene(input);
      scene.bubble = new Bubble(b.title, b.subtitle, false, 1);
      scene.knockText = l10n.t("knockWord");
      ctx.save();
      ctx.translate(col * W, row * (H + 20));
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      draw(ctx, { width: W, height: H }, scene, skinFor(skin));
      ctx.restore();
      label(ctx, `${skin} · ${name}`, col * W + W / 2, row * (H + 20) + H + 2, 0.8);
    });
  });
  return sheet;
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

/// GitHub banner / social preview (1280 x 640): title, tagline, and every character standing on a taskbar strip.
function renderBanner(): HTMLCanvasElement {
  const W = 1280;
  const H = 640;
  const [banner, ctx] = newCanvas(W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#34374f");
  bg.addColorStop(1, "#1d1f2e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 120, 40, W / 2, 120, 620);
  glow.addColorStop(0, "rgba(255, 170, 120, 0.16)");
  glow.addColorStop(1, "rgba(255, 170, 120, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const barTop = H - 58;
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.fillRect(0, barTop, W, H - barTop);
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(0, barTop, W, 1);

  drawTextAt(ctx, "ClaudeBuddy", { size: 92, weight: "black" }, W / 2, 112, WHITE);
  drawTextAt(
    ctx,
    "A desktop pet that knocks when your AI agent is done",
    { size: 30, weight: "bold" },
    W / 2,
    186,
    rgb(0.82, 0.83, 0.9),
  );
  drawTextAt(ctx, "Claude Code  ·  Codex  ·  any CLI", { size: 21, weight: "semibold" }, W / 2, 232, rgb(1, 0.68, 0.5));

  const l10n = new L10n("en");
  const b = l10n.bubble([makeWaiting("Claude", "my-app", { type: "finished" })]);
  // x = where each one stands; spaced by hand so the knock mark and the code symbols land on nobody
  type Cast = { skin: SkinID; x: number; activity: Activity; e: number; edit?: (i: AnimationInput) => void; knock?: boolean };
  const cast: Cast[] = [
    { skin: "byte", x: 92, activity: "laptop", e: 1.5 },
    { skin: "kitty", x: 262, activity: "wave", e: 0.8 },
    { skin: "puppy", x: 400, activity: "dance", e: 0.3 },
    { skin: "robo", x: 540, activity: "sit", e: 0.3, edit: (i) => (i.heartAges = [0.45]) },
    { skin: "buddy", x: 684, activity: "sit", e: 0.3, knock: true },
    { skin: "bunny", x: 874, activity: "meditate", e: 3 },
    { skin: "ninja", x: 1024, activity: "kata", e: 1.0 },
    { skin: "cyberNinja", x: 1172, activity: "shuriken", e: 0.9 },
  ];
  const scale = 1.1;
  cast.forEach((c) => {
    const input = new AnimationInput(10.05 + c.e);
    input.activity = c.activity;
    input.activityElapsed = c.e;
    c.edit?.(input);
    if (c.knock === true) {
      input.mode = "alert";
      input.knockHits = Knocking.schedule(1.0);
      input.alertElapsed = 1.27;
    }
    const scene = Animator.scene(input);
    if (c.knock === true) {
      scene.bubble = new Bubble(b.title, b.subtitle, false, 1);
      scene.bubble.scale = IN_PLACE_BUBBLE_SCALE;
      scene.knockText = l10n.t("knockWord");
    }
    ctx.save();
    // Feet (cell y ~ 230 of 240) on the taskbar line.
    ctx.translate(c.x - (CELL_W * scale) / 2, barTop - 228 * scale);
    ctx.scale(scale, scale);
    draw(ctx, { width: CELL_W, height: CELL_H }, scene, skinFor(c.skin));
    ctx.restore();
  });
  return banner;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const lang: Language = params.get("lang") === "fa" ? "fa" : "en";
  const mode = params.get("mode") ?? "sheet";
  const variant: FontVariant = params.get("font") === "segoe" ? "segoe" : "nunito";
  setFontVariant(variant);
  await loadFonts();
  const l10n = new L10n(lang);
  if (mode === "impatient") {
    await invoke("snapshot_done", { pngBase64: pngBase64(renderImpatient(l10n)), menubarBase64: null });
  } else if (mode === "tweet" || mode === "tweetinplace") {
    await invoke("snapshot_done", { pngBase64: pngBase64(renderTweet(mode === "tweetinplace")), menubarBase64: null });
  } else if (mode === "banner") {
    await invoke("snapshot_done", { pngBase64: pngBase64(renderBanner()), menubarBase64: null });
  } else if (mode === "inplace") {
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
