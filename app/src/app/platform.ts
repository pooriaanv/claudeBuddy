// The Tauri side of the pet: IPC commands (12-windows-plan.md section 3) and the canvas.

import { invoke } from "@tauri-apps/api/core";
import type { PetScene } from "../core/pose";
import { drawScene } from "../render/sceneRenderer";
import type { Skin } from "../render/skins/skin";
import type { MonitorInfo, Rect } from "./geometry";
import type { PetPlatform } from "./pet";
import type { PetLevel, PointerState } from "./types";

export const ipc = {
  monitors: (): Promise<MonitorInfo[]> => invoke<MonitorInfo[]>("monitors"),
  pointerState: (): Promise<PointerState> => invoke<PointerState>("pointer_state"),
  setClickThrough: (enabled: boolean): void => {
    void invoke("set_click_through", { enabled }).catch(() => {});
  },
  petReady: (): Promise<void> => invoke("pet_ready"),
};

/// Draws into the one full-window canvas and talks to Win32 through the commands.
export class TauriPlatform implements PetPlatform {
  private last: Rect | null = null;
  private canvasW = 0;
  private canvasH = 0;
  private frameCalls = 0;
  private frameTotalMs = 0;
  private frameMaxMs = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  pointerState(): Promise<PointerState> {
    return ipc.pointerState();
  }

  setFrame(f: Rect): void {
    const l = this.last;
    if (l !== null && l.x === f.x && l.y === f.y && l.w === f.w && l.h === f.h) return;
    this.last = f;
    const t0 = performance.now();
    invoke("set_pet_frame", { x: f.x, y: f.y, w: f.w, h: f.h })
      .then(() => {
        const ms = performance.now() - t0;
        this.frameCalls += 1;
        this.frameTotalMs += ms;
        this.frameMaxMs = Math.max(this.frameMaxMs, ms);
      })
      .catch(() => {});
  }

  setLevel(level: PetLevel): void {
    void invoke("set_pet_level", { level }).catch(() => {});
  }

  dropLevel(x: number, y: number): void {
    void invoke("drop_pet_level", { x, y }).catch(() => {});
  }

  /// The canvas is sized explicitly (physical px backing store, CSS px = physical / dpr), never by the viewport: while
  /// the window is still catching up with a resize, the picture is clipped instead of stretched.
  draw(scene: PetScene, skin: Skin, frame: Rect): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, frame.w);
    const h = Math.max(1, frame.h);
    if (this.canvasW !== w || this.canvasH !== h || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; // assigning resets the context and clears the canvas
      this.canvas.height = h;
      this.canvas.style.width = `${w / dpr}px`;
      this.canvas.style.height = `${h / dpr}px`;
      this.canvasW = w;
      this.canvasH = h;
    }
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) throw new Error("2d context unavailable");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, w / dpr, h / dpr, scene, skin);
  }

  takeFrameStats(): string | null {
    if (this.frameCalls === 0) return null;
    const s = `set_pet_frame n=${this.frameCalls} avg=${(this.frameTotalMs / this.frameCalls).toFixed(2)} ms max=${this.frameMaxMs.toFixed(2)} ms`;
    this.frameCalls = 0;
    this.frameTotalMs = 0;
    this.frameMaxMs = 0;
    return s;
  }
}
