// Text for the renderer: font stacks, `measure` (= SwiftUI `ResolvedText.measure(in:)`) and `drawBlock`
// (= `GraphicsContext.draw(_ resolved: ResolvedText, in: rect)` / `draw(_, at:)`).
//
// Swift draws `Text(...).font(.system(size:weight:design: .rounded))`. SF Pro Rounded cannot ship on Windows, so the
// stand-ins live in ONE place, FONT_FAMILIES below (Pooria approves the choice later; 12-windows-plan.md Q5/Q6):
//   Latin rounded  -> Nunito (OFL, bundled via @fontsource), weights 500/600/800/900 = medium/semibold/heavy/black
//   Persian        -> Vazirmatn (OFL, bundled), first in the stack for strings that contain Arabic-script characters
//   emoji          -> system "Segoe UI Emoji"
//   `.system(...)` -> system "Segoe UI" (snapshot labels, the note glyphs, the CJK plate)
// This file has no DOM/CSS imports (so it stays importable from tests); the font files are loaded by `fonts.ts`.

import type { Color } from "./paint";

/// The single font constant. `latin` can be swapped at runtime with `setFontVariant("segoe")`.
export const FONT_FAMILIES = {
  /// SF Pro Rounded stand-in.
  latin: '"Nunito"',
  /// Used first when a string contains Persian/Arabic text.
  persian: '"Vazirmatn Variable"',
  emoji: '"Segoe UI Emoji"',
  /// `.system(size:weight:)` without `design: .rounded`; the trailing families cover ♪♫ and the CJK plate (影).
  system: '"Segoe UI"',
  symbols: '"Segoe UI Symbol"',
  cjk: '"Yu Gothic UI", "Microsoft YaHei UI", "Meiryo UI"',
} as const;

export type FontVariant = "nunito" | "segoe";

let roundedFamily: string = FONT_FAMILIES.latin;

/// `segoe` renders the "rounded" text with Segoe UI instead of Nunito (for comparing the two choices).
export function setFontVariant(variant: FontVariant): void {
  roundedFamily = variant === "segoe" ? FONT_FAMILIES.system : FONT_FAMILIES.latin;
}

/// SwiftUI `Font.Weight` -> CSS weight.
export const Weight = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 } as const;
export type WeightName = keyof typeof Weight;

/// `rounded` = `.system(size, weight, design: .rounded)`; `system` = `.system(size, weight)`.
export interface TextFont {
  size: number;
  weight: WeightName;
  design?: "rounded" | "system";
}

/// Persian/Arabic text: Arabic, Arabic Supplement, Presentation Forms-A and -B.
function hasArabicScript(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x600 && c <= 0x6ff) || (c >= 0x750 && c <= 0x77f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) {
      return true;
    }
  }
  return false;
}

/// CSS `font` for `font`; `text` selects the Persian-first stack (only strings that really contain Persian text).
/// Vazirmatn sets smaller than the Arabic font macOS falls back to (about 8 % in the reference sheet).
const PERSIAN_SIZE_SCALE = 1.08;

export function cssFont(font: TextFont, text = ""): string {
  const w = Weight[font.weight];
  const persianText = hasArabicScript(text);
  const px = `${persianText ? font.size * PERSIAN_SIZE_SCALE : font.size}px`;
  if ((font.design ?? "rounded") === "system") {
    return `${w} ${px} ${FONT_FAMILIES.system}, ${FONT_FAMILIES.emoji}, ${FONT_FAMILIES.symbols}, ${FONT_FAMILIES.cjk}, sans-serif`;
  }
  const persian = persianText ? `${FONT_FAMILIES.persian}, ` : "";
  return `${w} ${px} ${persian}${roundedFamily}, ${FONT_FAMILIES.system}, ${FONT_FAMILIES.emoji}, ${FONT_FAMILIES.symbols}, sans-serif`;
}

/// Nunito is narrower than SF Pro Rounded (about 8 % at heavy, 3 % at medium). Letter spacing (em, by weight) brings the
/// widths back so bubble / pill sizes and line breaks match the Mac layout. Only for Latin text in the Nunito variant:
/// cursive Persian must not be spaced.
const NUNITO_TRACKING_EM: Record<WeightName, number> = {
  regular: 0.01,
  medium: 0.016,
  semibold: 0.05,
  bold: 0.03,
  heavy: 0.045,
  black: 0.04,
};

/// Segoe UI at 11 px is about 8 % narrower than SF Pro Text (snapshot labels only).
const SYSTEM_REGULAR_TRACKING_EM = 0.035;

export function trackingPx(font: TextFont, text: string): number {
  if (hasArabicScript(text)) return 0;
  if ((font.design ?? "rounded") === "system") return font.weight === "regular" ? SYSTEM_REGULAR_TRACKING_EM * font.size : 0;
  if (roundedFamily !== FONT_FAMILIES.latin) return 0;
  return NUNITO_TRACKING_EM[font.weight] * font.size;
}

/// SF Pro metrics (ascent 0.952, descent 0.244 -> 1.196 em); the reference bubble heights match line = 1.2 em.
export const LINE_HEIGHT = 1.2;
const BASELINE = 0.954;

type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let measureCtx: TextContext | null = null;

function measuring(): TextContext {
  if (measureCtx === null) {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const ctx = canvas.getContext("2d") as TextContext | null;
    if (ctx === null) throw new Error("2d context unavailable");
    measureCtx = ctx;
  }
  return measureCtx;
}

function setup(ctx: TextContext, font: string, rtl: boolean, spacing: number): void {
  ctx.font = font;
  ctx.letterSpacing = `${spacing}px`;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textRendering = "geometricPrecision";
  ctx.fontKerning = "normal";
}

/// A laid-out `Text`: what `measure` returns and `drawBlock` consumes.
export interface TextBlock {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
  font: TextFont;
  css: string;
  spacing: number;
  rtl: boolean;
}

/// Greedy word wrap to `maxWidth`, like `Text` in a proposed size: words that do not fit move to the next line, a
/// word wider than the line breaks by character, and when `maxHeight` allows fewer lines than needed the last
/// visible line is truncated with an ellipsis. `width` is the widest line, `height` is lines x line height.
// port of SwiftUI Text.measure(in:), see 04-rendering.md ("measureText + manual wrapping to the same max width")
export function measure(text: string, font: TextFont, maxWidth: number, maxHeight = Infinity, rtl = false): TextBlock {
  const css = cssFont(font, text);
  const spacing = trackingPx(font, text);
  const ctx = measuring();
  setup(ctx, css, rtl, spacing);
  const w = (s: string): number => ctx.measureText(s).width;
  const lineHeight = font.size * LINE_HEIGHT;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight + 1e-6));

  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      if (word === "") continue;
      const candidate = line === "" ? word : `${line} ${word}`;
      if (w(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      line = word;
      // A single word that is too wide: break it by character.
      while (w(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && w(line.slice(0, cut)) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 0 && w(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[maxLines - 1] = `${last}…`;
  }

  const width = Math.min(maxWidth, Math.max(0, ...lines.map(w)));
  return { lines, width, height: lines.length * lineHeight, lineHeight, font, css, spacing, rtl };
}

/// `context.draw(label, in: CGRect(x: x, y: y, width: block.width, height: block.height))`: the block's top-left is
/// (x, y). Lines are leading-aligned (right-aligned for RTL), as SwiftUI lays out a wrapped `Text`.
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  x: number,
  y: number,
  color: Color,
  embolden = 0,
): void {
  ctx.save();
  setup(ctx, block.css, block.rtl, block.spacing);
  ctx.fillStyle = color.css;
  if (embolden > 0) {
    // Faux weight for glyphs whose system font has no heavy face (the CJK plate).
    ctx.strokeStyle = color.css;
    ctx.lineWidth = embolden;
    ctx.lineJoin = "round";
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = block.rtl ? "right" : "left";
  const lx = block.rtl ? x + block.width : x;
  const half = (block.lineHeight - block.font.size * LINE_HEIGHT) / 2; // 0: line height is exactly 1.2 em
  block.lines.forEach((line, i) => {
    const by = y + i * block.lineHeight + half + block.font.size * BASELINE;
    if (embolden > 0) ctx.strokeText(line, lx, by);
    ctx.fillText(line, lx, by);
  });
  ctx.restore();
}

/// `context.draw(Text(...), at: point)` (anchor .center): the block is centered on (cx, cy).
export function drawBlockAt(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  cx: number,
  cy: number,
  color: Color,
  embolden = 0,
): void {
  drawBlock(ctx, block, cx - block.width / 2, cy - block.height / 2, color, embolden);
}

/// Convenience: one unwrapped line drawn centered on a point.
export function drawTextAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: TextFont,
  cx: number,
  cy: number,
  color: Color,
  rtl = false,
): void {
  drawBlockAt(ctx, measure(text, font, Infinity, Infinity, rtl), cx, cy, color);
}
