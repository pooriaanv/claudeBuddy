// port of Sources/ClaudeBuddy/Render/SceneRenderer.swift (Mac reference v0.0.9)
//
// `SceneRenderer.draw` (shadow, body transforms, the character, effects, bubble / hint), `SceneView` as `drawScene`
// and `SkinPreview` (self-animating preview for the settings window, 15 fps).
//
// Swift `var g = ctx; ... g.translateBy(...)` copies are `ctx.save()` ... `ctx.restore()` here.

import { AnimationInput, Animator } from "../core/animation";
import type { Activity } from "../core/brain";
import type { Bubble, PetScene, Point, SkinID, Size } from "../core/pose";
import { BLACK, Palette, Paint, WHITE, circle, ellipse, fill, line, pt, rgb, rotated, roundedRect, stroke } from "./paint";
import { drawBlock, drawBlockAt, measure } from "./text";
import type { TextFont } from "./text";
import { skinFor } from "./skins/catalog";
import type { Skin } from "./skins/skin";

/// Design canvas: the 200×300 character space plus margins for the bubble and the knocking hand.
export const design: Size = { width: 240, height: 320 };

/// `SceneRenderer.draw`: shadow, body transforms, the character, then effects and the speech bubble.
/// `size` is the drawing area in the context's current units (CSS px); the context's transform is restored on return.
export function draw(ctx: CanvasRenderingContext2D, size: Size, scene: PetScene, skin: Skin): void {
  ctx.save();
  const s = size.width / design.width;
  ctx.scale(s, s);
  // Windows addition: a window taller than 240:320 (the in-place knock adds room for the bubble on top) keeps the
  // character at the bottom; for every other frame this is 0.
  const extraTop = Math.max(0, size.height / s - design.height);
  ctx.translate(20 + scene.shake.width, 20 + extraTop + scene.shake.height);
  const p = scene.pose;

  const shadowScale = Math.max(0.4, 1 + p.lift / 80) * (0.6 + 0.4 * scene.shadow);
  fill(ctx, ellipse(pt(100, 288), 110 * shadowScale, 12 * shadowScale), BLACK.opacity(0.04 + 0.1 * scene.shadow));

  ctx.save(); // var body = ctx
  // Windows addition: cross-legged skins sit down onto their folded legs while meditating.
  ctx.translate(0, p.lift + skin.lotusDrop * p.lotus);
  if (p.lean !== 0 && skin.usesLean) rotated(ctx, p.lean, pt(100, 288));
  if (p.swing !== 0) rotated(ctx, p.swing, pt(100, 70));
  skin.draw(ctx, p);
  ctx.restore();

  // glassMark is drawn with `ctx` (not `fx`): the lift is added to its point instead.
  const hit = skin.knockPoint(p);
  scene.knockAges.forEach((age, n) =>
    glassMark(ctx, pt(hit.x, hit.y + p.lift), age, scene.knockWords[n] ?? scene.knockText),
  );
  // Windows addition: the glass the buddy knocked on cracks (in front of the buddy - it is behind the glass).
  // The window in character space is x -20...220, y (-20 - extraTop)...300: the crack stays inside it.
  if (scene.crackAge >= 0) crackedGlass(ctx, hit, scene.crackAge, { x: -16, y: -16 - extraTop, w: 232, h: 312 + extraTop });
  ctx.save(); // var fx = ctx
  ctx.translate(0, p.lift);
  scene.heartAges.forEach((age, i) => hearts(ctx, age, i));
  if (scene.sleeping) zzz(ctx, p.t);
  if (scene.dancing) notes(ctx, p.t);
  if (scene.zen) zen(ctx, p.t);
  if (scene.coding) codeBits(ctx, p.t);
  ctx.restore();
  if (scene.bubble !== null) drawBubble(ctx, scene.bubble);
  else if (scene.hint !== null) drawHint(ctx, scene.hint, p.t);

  ctx.restore();
}

/// U+200F RIGHT-TO-LEFT MARK, the leading mark Swift puts on bubble strings in RTL.
const RLM = String.fromCharCode(0x200f);

// Font specs (SceneRenderer.swift): all `.system(size:weight:design: .rounded)` unless noted.
const HINT_FONT: TextFont = { size: 15, weight: "semibold" };
const KNOCK_FONT: TextFont = { size: 13, weight: "black" };
const BUBBLE_TITLE_FONT: TextFont = { size: 13, weight: "heavy" };
const BUBBLE_SUB_FONT: TextFont = { size: 9, weight: "medium" };
const NOTE_FONT: TextFont = { size: 16, weight: "bold", design: "system" };

/// A small floating tag above the head. Deliberately quiet: no motion beyond a slow float.
// port of SceneRenderer.drawHint
/// Windows only (Pooria, 2026-10-15): the Mac draws the hint pill at 15 pt, which is ~9 px on a 100 % Windows screen
/// (sharp on Retina, hard to read here). The whole pill is scaled around its anchor. 1 = Mac.
export const HINT_SCALE = 1.6;

/// Windows addition: bubble scale for the in-place knock (fits one line inside the desktop-size window).
export const IN_PLACE_BUBBLE_SCALE = 1.45;

export function drawHint(ctx: CanvasRenderingContext2D, text: string, t: number): void {
  ctx.save();
  ctx.translate(0, Math.sin(t * 1.6) * 1.5);
  ctx.translate(100, 20);
  ctx.scale(HINT_SCALE, HINT_SCALE);
  ctx.translate(-100, -20);
  // Mac: 170 pt of text in a 240-wide design. Scaled up, keep the whole pill inside the window (long names truncate).
  const label = measure(text, HINT_FONT, Math.min(170, 236 / HINT_SCALE - 22), 22);
  const w = label.width + 22;
  const h = 26;
  const rx = 100 - w / 2;
  const ry = 20 - h / 2;
  const pill = roundedRect(rx, ry, w, h, h / 2);
  ctx.save(); // var shadow = g
  ctx.translate(0, 1.5);
  fill(ctx, pill, BLACK.opacity(0.15));
  ctx.restore();
  fill(ctx, pill, WHITE.opacity(0.92));
  stroke(ctx, pill, rgb(0.36, 0.72, 0.45).opacity(0.7), 1.5);
  drawBlock(ctx, label, rx + 11, ry + h / 2 - label.height / 2, Palette.ink.opacity(0.85));
  ctx.restore();
}

// port of SceneRenderer.glassMark
export function glassMark(ctx: CanvasRenderingContext2D, p: Point, age: number, text: string): void {
  const fog = Math.max(0, 1 - age / 2.5);
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 24);
  grad.addColorStop(0, WHITE.opacity(0.45 * fog).css);
  grad.addColorStop(1, WHITE.opacity(0).css);
  ctx.fillStyle = grad;
  ctx.fill(ellipse(p, 46, 40));
  if (age < 0.5) {
    const f = 1 - age / 0.5;
    const r = 14 + age * 70;
    stroke(ctx, circle(p, r * 2), WHITE.opacity(0.75 * f), 2.5);
    stroke(ctx, circle(p, r * 2 + 4), Palette.ink.opacity(0.3 * f), 1);
  }
  if (age < 0.16) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 2 * Math.PI + 0.3;
      const l = new Path2D();
      l.moveTo(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20);
      l.lineTo(p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30);
      line(ctx, l, Palette.ink.opacity(0.8), 2.2);
    }
  }
  if (age < 0.6) {
    ctx.save();
    ctx.globalAlpha = 1 - age / 0.6;
    drawBlockAt(
      ctx,
      measure(text, KNOCK_FONT, Infinity),
      p.x + 14,
      p.y - 42 - age * 20,
      rgb(0.66, 0.33, 0.23),
    );
    ctx.restore();
  }
}

// port of SceneRenderer.hearts
export function hearts(ctx: CanvasRenderingContext2D, age: number, index: number): void {
  for (let k = 0; k < 3; k++) {
    const a = age - k * 0.12;
    if (!(a > 0 && a < 1.3)) continue;
    const x = 100 + [-30, 4, 34][k] + Math.sin(a * 6 + k) * 5;
    const y = 70 - a * 60 - (index % 3) * 6;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1.3 - a) / 0.4);
    const size = 14 * Math.min(1, a / 0.15);
    fill(ctx, Paint.heart(pt(x, y), size), Palette.heart);
    ctx.restore();
  }
}

// port of SceneRenderer.zzz
export function zzz(ctx: CanvasRenderingContext2D, t: number): void {
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.45 + k / 3) % 1; // truncatingRemainder
    ctx.save();
    ctx.globalAlpha = Math.sin(ph * Math.PI);
    drawBlockAt(
      ctx,
      measure("z", { size: 10 + ph * 10, weight: "heavy" }, Infinity),
      150 + ph * 22,
      78 - ph * 44,
      rgb(0.42, 0.48, 0.62),
    );
    ctx.restore();
  }
}

// port of SceneRenderer.notes
/// Windows addition (Pooria, 2026-10-15): three small sparkles slowly circling the head while meditating.
export function zen(ctx: CanvasRenderingContext2D, t: number): void {
  for (let k = 0; k < 3; k++) {
    const a = t * 0.9 + (k * Math.PI * 2) / 3;
    const x = 100 + Math.cos(a) * 78;
    const y = 120 + Math.sin(a) * 22;
    ctx.save();
    ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(t * 2.2 + k * 2);
    fill(ctx, Paint.sparkle(pt(x, y), 7, 2.4), rgb(1.0, 0.86, 0.45));
    ctx.restore();
  }
}

export function notes(ctx: CanvasRenderingContext2D, t: number): void {
  for (let k = 0; k < 2; k++) {
    const ph = (t * 0.7 + k / 2) % 1;
    ctx.save();
    ctx.globalAlpha = Math.sin(ph * Math.PI);
    const side = k === 0 ? -1 : 1;
    drawBlockAt(
      ctx,
      measure(k === 0 ? "♪" : "♫", NOTE_FONT, Infinity),
      100 + side * (70 + ph * 10),
      120 - ph * 50,
      rgb(0.55, 0.42, 0.85),
    );
    ctx.restore();
  }
}

// port of SceneRenderer.drawBubble
export function drawBubble(ctx: CanvasRenderingContext2D, b: Bubble): void {
  const appear = b.appear;
  if (!(appear > 0)) return;
  ctx.save();
  const tail = pt(122, 60);
  const mark = b.rtl ? RLM : "";
  const title = measure(mark + b.title, BUBBLE_TITLE_FONT, 176, 40, b.rtl);
  const sub = measure(mark + b.subtitle, BUBBLE_SUB_FONT, 176, 30, b.rtl);
  const w = Math.min(196, Math.max(title.width, sub.width) + 24);
  // Windows: a scaled-up bubble (in-place knock) shrinks just enough to stay inside the window instead of wrapping
  // (its left edge, scaled around the tail, must stay right of the window's left edge).
  const fit = b.scale > 1 ? Math.min(b.scale, 138 / (22 + w / 2)) : b.scale;
  ctx.translate(tail.x, tail.y);
  const pop = (0.6 + 0.4 * appear + Math.sin(appear * Math.PI) * 0.08) * fit;
  ctx.scale(pop, pop);
  ctx.translate(-tail.x, -tail.y);
  ctx.globalAlpha = appear;

  const h = title.height + sub.height + 18;
  const rx = 100 - w / 2;
  const ry = 50 - h;
  const maxY = ry + h;

  const bubble = roundedRect(rx, ry, w, h, 16);
  // Swift: move(tail.x - 8, maxY - 1) -> line(tail.x + 4, tail.y) -> line(tail.x + 6, maxY - 1). The tail is wound the
  // same way as the rounded rect here (clockwise), so the 1 px overlap can never cancel out under the nonzero rule.
  bubble.moveTo(tail.x - 8, maxY - 1);
  bubble.lineTo(tail.x + 6, maxY - 1);
  bubble.lineTo(tail.x + 4, tail.y);
  ctx.save(); // var shadow = g
  ctx.translate(0, 2.5);
  fill(ctx, bubble, BLACK.opacity(0.18));
  ctx.restore();
  fill(ctx, bubble, WHITE);
  stroke(ctx, roundedRect(rx, ry, w, h, 16), rgb(0.85, 0.47, 0.34).opacity(0.55), 1.5);
  drawBlock(ctx, title, 100 - title.width / 2, ry + 8, Palette.ink);
  drawBlock(ctx, sub, 100 - sub.width / 2, ry + 10 + title.height, Palette.ink.opacity(0.65));
  ctx.restore();
}

/// `SceneView`: draws one scene into a canvas of `cssWidth` x `cssHeight` CSS px. The context must already carry the
/// device-pixel-ratio transform (`setTransform(dpr, 0, 0, dpr, 0, 0)`). Clears first (a SwiftUI `Canvas` starts empty).
export function drawScene(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  scene: PetScene,
  skin: Skin,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  draw(ctx, { width: cssWidth, height: cssHeight }, scene, skin);
}

/// Seconds between 1970-01-01 and 2001-01-01 (Swift `timeIntervalSinceReferenceDate`).
const REFERENCE_DATE_OFFSET = 978307200;

/// One `SkinPreview` frame at time `t` (reference-date seconds).
export function skinPreviewScene(activity: Activity, t: number): PetScene {
  const input = new AnimationInput(t);
  input.activity = activity;
  input.activityElapsed = t % (activity === "wave" ? 4 : 3);
  if (activity === "wave" && input.activityElapsed > 1.8) input.activity = "sit";
  return Animator.scene(input);
}

/// `SkinPreview`: a self-animating preview (settings window), redrawn at 15 fps.
export class SkinPreview {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    public skin: SkinID,
    public activity: Activity = "sit",
  ) {}

  start(): void {
    if (this.timer !== null) return;
    const tick = (): void => {
      this.frame();
      this.timer = setTimeout(tick, 1000 / 15);
    };
    tick();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /// Draws the current frame (backing store follows the canvas' CSS size x devicePixelRatio).
  frame(): void {
    const dpr = window.devicePixelRatio || 1;
    const box = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = Date.now() / 1000 - REFERENCE_DATE_OFFSET;
    drawScene(ctx, box.width, box.height, skinPreviewScene(this.activity, t), skinFor(this.skin));
  }
}

export const SceneRenderer = { design, draw, drawScene, drawHint, drawBubble, glassMark, hearts, zzz, notes };

/// Windows addition (Pooria, 2026-10-16): little code symbols drifting up from the laptop.
const CODE_FONT: TextFont = { size: 15, weight: "heavy", design: "rounded" };
export function codeBits(ctx: CanvasRenderingContext2D, t: number): void {
  const bits = ["</>", "{ }", "›_"];
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.45 + k / 3) % 1;
    ctx.save();
    ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
    const side = k === 1 ? 1 : -1;
    drawBlockAt(ctx, measure(bits[k], CODE_FONT, Infinity), 186 + side * 9 + ph * 6, 196 - ph * 80, rgb(1.0, 0.72, 0.45));
    ctx.restore();
  }
}

/// Windows addition (Pooria, 2026-10-21): cracks running out from the impact point, grown over 0.25 s and then
/// left there. Deterministic (fixed seed), so every frame draws the same crack.
export function crackedGlass(
  ctx: CanvasRenderingContext2D,
  p: Point,
  age: number,
  box: { x: number; y: number; w: number; h: number },
): void {
  const inside = (q: Point): boolean => q.x > box.x && q.y > box.y && q.x < box.x + box.w && q.y < box.y + box.h;
  let seed = 7919;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const grow = Math.min(1, age / 0.25);
  const rays: Point[][] = [];
  const RAYS = 11;
  for (let r = 0; r < RAYS; r++) {
    let a = (r / RAYS) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const length = 110 + rnd() * 170;
    const pts: Point[] = [p];
    let x = p.x;
    let y = p.y;
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      a += (rnd() - 0.5) * 0.45;
      let seg = (length / steps) * (0.7 + rnd() * 0.6);
      // shorten the step until it stays on the glass (inside the window); a ray that cannot goes no further
      for (let k = 0; k < 4 && !inside(pt(x + Math.cos(a) * seg, y + Math.sin(a) * seg)); k++) seg *= 0.5;
      if (!inside(pt(x + Math.cos(a) * seg, y + Math.sin(a) * seg))) break;
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
      pts.push(pt(x, y));
    }
    rays.push(pts);
  }
  // the part of a polyline that has grown so far
  const grown = (pts: Point[], g: number): Path2D => {
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    const n = (pts.length - 1) * g;
    for (let i = 1; i < pts.length; i++) {
      if (i <= n) path.lineTo(pts[i].x, pts[i].y);
      else {
        const f = n - (i - 1);
        if (f > 0) path.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
        break;
      }
    }
    return path;
  };
  const cracks: { path: Path2D; width: number }[] = [];
  for (const ray of rays) {
    cracks.push({ path: grown(ray, grow), width: 1 });
    // a couple of short branches off each ray
    for (let b = 0; b < 2 && ray.length >= 3; b++) {
      const at = 1 + Math.floor(rnd() * (ray.length - 2));
      const from = ray[at];
      const dir = Math.atan2(ray[at].y - ray[at - 1].y, ray[at].x - ray[at - 1].x) + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);
      let len = 18 + rnd() * 40;
      while (len > 4 && !inside(pt(from.x + Math.cos(dir + 0.2) * len, from.y + Math.sin(dir + 0.2) * len))) len *= 0.6;
      const branch = [from, pt(from.x + Math.cos(dir) * len * 0.5, from.y + Math.sin(dir) * len * 0.5), pt(from.x + Math.cos(dir + 0.2) * len, from.y + Math.sin(dir + 0.2) * len)];
      cracks.push({ path: grown(branch, Math.max(0, (grow - at / ray.length) * 2)), width: 0.7 });
    }
  }
  // spider-web rings joining neighbouring rays near the impact
  for (const ring of [0.18, 0.4]) {
    const web = new Path2D();
    rays.forEach((ray, r) => {
      const next = rays[(r + 1) % rays.length];
      const i = Math.max(1, Math.round(ring * 6));
      if (grow < ring || i >= ray.length || i >= next.length) return;
      web.moveTo(ray[i].x, ray[i].y);
      web.lineTo(next[i].x, next[i].y);
    });
    cracks.push({ path: web, width: 0.7 });
  }
  ctx.save();
  // the shattered spot at the impact
  const spot = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
  spot.addColorStop(0, WHITE.opacity(0.6).css);
  spot.addColorStop(1, WHITE.opacity(0).css);
  ctx.fillStyle = spot;
  ctx.fill(circle(p, 32));
  for (const c of cracks) line(ctx, c.path, Palette.ink.opacity(0.55), 2.4 * c.width);
  ctx.translate(-0.7, -0.7);
  for (const c of cracks) line(ctx, c.path, WHITE.opacity(0.9), 1.1 * c.width);
  ctx.restore();
}
