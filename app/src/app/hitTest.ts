// Input for the pet window (12-windows-plan.md D6): per-pixel click-through, click vs drag.
// port of PetHostView (PetWindow.swift): `mouseDown` / `mouseDragged` / `mouseUp` with the 4 pt Manhattan threshold,
// dragging only when `canDrag()` (idle).
//
// How the Windows version differs from the Mac one (which gets all of this from AppKit):
// - The window is click-through (`WS_EX_TRANSPARENT`) until the cursor is over an opaque pixel. The Rust hover thread
//   reports the cursor (`pet-hover`, 30 Hz); `PetInput.onHover` reads the canvas alpha there (> 20 = interactive).
// - The press starts from the DOM `pointerdown` (+ pointer capture); positions always come from `pointer_state()`
//   (global physical px), never from DOM coordinates; `pointerup` / `lostpointercapture` end it, and as a safety net
//   the frame tick ends the press when the primary button is no longer down.

import type { Point } from "../core/pose";
import type { Rect } from "./geometry";
import type { HoverEvent, PointerState } from "./types";

/// Alpha above which a pixel of the pet counts as the pet (0...255).
export const OPAQUE_ALPHA = 20;

/// Mac `PetHostView.mouseDragged`: a press becomes a drag after this much Manhattan distance (points).
export const DRAG_THRESHOLD_PT = 4;

/// What the press logic needs from the pet (the `PetHostView` callbacks + geometry).
export interface PressHandler {
  /// px per pt of the screen the pet is on.
  scale(): number;
  /// The window frame as last applied (global physical px).
  frame(): Rect;
  canDrag(): boolean;
  clicked(): void;
  dragBegan(): void;
  dragMoved(p: Point, grab: Point): void;
  dragEnded(): void;
  /// A press started / ended (lets the frame clock speed up while the button is down).
  pressChanged(pressing: boolean): void;
}

/// The press state machine of `PetHostView`, free of DOM so it can be unit-tested.
export class PressTracker {
  private _pressing = false;
  private _dragging = false;
  private downAt: Point | null = null;
  private grab: Point = { x: 0, y: 0 };
  private lastMoved: Point | null = null;
  private pressedAt = 0;

  constructor(private readonly handler: PressHandler) {}

  get pressing(): boolean {
    return this._pressing;
  }

  get dragging(): boolean {
    return this._dragging;
  }

  /// `mouseDown` (part 1): the DOM `pointerdown`. `at` = `performance.now()` in ms.
  down(at: number): void {
    this._pressing = true;
    this._dragging = false;
    this.downAt = null;
    this.lastMoved = null;
    this.pressedAt = at;
    this.handler.pressChanged(true);
  }

  /// `mouseDown` (part 2): the pointer state fetched for the press; sets `downAt` and the grab offset inside the window.
  anchor(ps: PointerState): void {
    if (!this._pressing || this.downAt !== null) return;
    this.downAt = { x: ps.x, y: ps.y };
    const f = this.handler.frame();
    this.grab = { x: ps.x - f.x, y: ps.y - f.y };
  }

  /// `mouseDragged` + the release safety net. Called on every frame tick with a fresh sample taken at `sampledAt`
  /// (ms, `performance.now()` just before the sample was requested).
  update(ps: PointerState, sampledAt: number): void {
    if (!this._pressing) return;
    // A sample requested before this press started can say "button up"; only a later one means a real release.
    if (!ps.leftDown && sampledAt > this.pressedAt) {
      this.up();
      return;
    }
    const d = this.downAt;
    if (!this.handler.canDrag() || d === null) return;
    const p = { x: ps.x, y: ps.y };
    if (!this._dragging && Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > DRAG_THRESHOLD_PT * this.handler.scale()) {
      this._dragging = true;
      this.handler.dragBegan();
    }
    // AppKit sends mouseDragged only when the mouse moved; dragMoved feeds the swing, so keep that rule.
    if (this._dragging && (this.lastMoved === null || this.lastMoved.x !== p.x || this.lastMoved.y !== p.y)) {
      this.lastMoved = p;
      this.handler.dragMoved(p, this.grab);
    }
  }

  /// `mouseUp`: ends a drag or counts as a click.
  up(): void {
    if (!this._pressing) return;
    this._pressing = false;
    const wasDragging = this._dragging;
    this._dragging = false;
    this.downAt = null;
    this.lastMoved = null;
    this.handler.pressChanged(false);
    if (wasDragging) this.handler.dragEnded();
    else this.handler.clicked();
  }
}

/// Alpha (0...255) of the canvas pixel at backing-store position (x, y); 0 outside the canvas or when unreadable.
export function alphaAt(ctx: CanvasRenderingContext2D, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const c = ctx.canvas;
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return 0;
  try {
    return ctx.getImageData(px, py, 1, 1).data[3];
  } catch {
    return 0;
  }
}

export interface InputIO {
  pointerState(): Promise<PointerState>;
  setClickThrough(enabled: boolean): void;
}

/// DOM glue: pointer events -> `PressTracker`, hover events -> `set_click_through`.
export class PetInput {
  /// The window starts click-through (Rust `apply_pet_ex_style`).
  private clickThrough = true;
  private hoverInside = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly press: PressTracker,
    private readonly io: InputIO,
  ) {}

  attach(): void {
    const finish = (): void => {
      this.press.up();
      // The cursor may have left the pet while the button was held: back to click-through.
      if (!this.press.pressing && !this.hoverInside) this.setClickThrough(true);
    };
    document.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // capture is best effort; the tick's release detection still works
      }
      this.press.down(performance.now());
      this.io
        .pointerState()
        .then((ps) => this.press.anchor(ps))
        .catch(() => {});
    });
    document.addEventListener("pointerup", (e) => {
      if (e.button === 0) finish();
    });
    document.addEventListener("pointercancel", finish);
    this.canvas.addEventListener("lostpointercapture", finish);
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /// `pet-hover`: the cursor is over the pet window rect (or left it).
  onHover(h: HoverEvent): void {
    this.hoverInside = h.inside;
    if (this.press.pressing) return; // a press in progress keeps the window interactive
    if (!h.inside) {
      this.setClickThrough(true);
      return;
    }
    const ctx = this.canvas.getContext("2d");
    const opaque = ctx !== null && alphaAt(ctx, h.x, h.y) > OPAQUE_ALPHA;
    this.setClickThrough(!opaque);
  }

  /// Per frame tick (after `pointer_state()`).
  update(ps: PointerState, sampledAt: number): void {
    const was = this.press.pressing;
    this.press.update(ps, sampledAt);
    // The safety net ended the press (missed pointerup) while the cursor is elsewhere: back to click-through.
    if (was && !this.press.pressing && !this.hoverInside) this.setClickThrough(true);
  }

  private setClickThrough(enabled: boolean): void {
    if (enabled === this.clickThrough) return;
    this.clickThrough = enabled;
    this.io.setClickThrough(enabled);
  }
}
