import { describe, expect, it } from "vitest";
import { OPAQUE_ALPHA, PressTracker, alphaAt } from "./hitTest";
import type { PressHandler } from "./hitTest";
import type { PointerState } from "./types";

function ps(x: number, y: number, leftDown = true): PointerState {
  return { x, y, leftDown, idleSecs: 0 };
}

function setup(opts: { scale?: number; canDrag?: boolean } = {}) {
  const calls: string[] = [];
  const state = { canDrag: opts.canDrag ?? true };
  const handler: PressHandler = {
    scale: () => opts.scale ?? 1,
    frame: () => ({ x: 1000, y: 500, w: 150, h: 200 }),
    canDrag: () => state.canDrag,
    clicked: () => calls.push("click"),
    dragBegan: () => calls.push("began"),
    dragMoved: (p, grab) => calls.push(`moved ${p.x},${p.y} grab ${grab.x},${grab.y}`),
    dragEnded: () => calls.push("ended"),
    pressChanged: (on) => calls.push(on ? "press" : "release"),
  };
  return { press: new PressTracker(handler), calls, state };
}

describe("PressTracker (PetHostView)", () => {
  it("press and release without moving is a click", () => {
    const { press, calls } = setup();
    press.down(100);
    press.anchor(ps(1050, 600));
    press.up();
    expect(calls).toEqual(["press", "release", "click"]);
  });

  it("a press becomes a drag after more than 4 pt of Manhattan distance, with the grab offset", () => {
    const { press, calls } = setup();
    press.down(100);
    press.anchor(ps(1050, 600)); // grab = (50, 100) inside the window
    press.update(ps(1052, 602), 120); // 2 + 2 = 4: not more than 4
    expect(calls).toEqual(["press"]);
    press.update(ps(1053, 602), 130); // 3 + 2 = 5 > 4
    expect(calls).toEqual(["press", "began", "moved 1053,602 grab 50,100"]);
    press.update(ps(1053, 602), 140); // did not move: no dragMoved (AppKit sends mouseDragged only on movement)
    expect(calls).toHaveLength(3);
    press.update(ps(1100, 560), 150);
    expect(calls[calls.length - 1]).toBe("moved 1100,560 grab 50,100");
    press.up();
    expect(calls.slice(-2)).toEqual(["release", "ended"]);
    expect(calls).not.toContain("click");
  });

  it("the threshold is 4 pt, i.e. 4 x scale px", () => {
    const { press, calls } = setup({ scale: 2 });
    press.down(1);
    press.anchor(ps(0, 0));
    press.update(ps(5, 3), 2); // 8 px = exactly 4 pt: not a drag yet
    expect(calls).toEqual(["press"]);
    press.update(ps(5, 4), 3); // 9 px > 8
    expect(calls[1]).toBe("began");
  });

  it("when dragging is not allowed (alert mode) moving does nothing and the release is a click", () => {
    const { press, calls } = setup({ canDrag: false });
    press.down(100);
    press.anchor(ps(1050, 600));
    press.update(ps(1300, 900), 120);
    press.up();
    expect(calls).toEqual(["press", "release", "click"]);
  });

  it("safety net: a later sample with the button up releases; an older sample does not", () => {
    const { press, calls } = setup();
    press.down(100);
    press.anchor(ps(1050, 600));
    press.update(ps(1050, 600, false), 99); // sampled before the press started: stale
    expect(press.pressing).toBe(true);
    press.update(ps(1050, 600, false), 101); // sampled after it: the button really is up
    expect(press.pressing).toBe(false);
    expect(calls).toEqual(["press", "release", "click"]);
  });

  it("a release during a drag ends the drag", () => {
    const { press, calls } = setup();
    press.down(100);
    press.anchor(ps(1050, 600));
    press.update(ps(1200, 600), 110);
    press.update(ps(1200, 600, false), 120);
    expect(calls[calls.length - 2]).toBe("release");
    expect(calls[calls.length - 1]).toBe("ended");
  });

  it("up() without a press is ignored", () => {
    const { press, calls } = setup();
    press.up();
    expect(calls).toEqual([]);
  });
});

describe("alphaAt", () => {
  it("reads the alpha channel, 0 outside the canvas or when unreadable", () => {
    const ctx = {
      canvas: { width: 10, height: 10 },
      getImageData: (x: number, y: number) => ({ data: [0, 0, 0, x === 3 && y === 4 ? 200 : 5] }),
    } as unknown as CanvasRenderingContext2D;
    expect(alphaAt(ctx, 3.7, 4.2)).toBe(200);
    expect(alphaAt(ctx, 1, 1)).toBe(5);
    expect(alphaAt(ctx, -1, 1)).toBe(0);
    expect(alphaAt(ctx, 10, 1)).toBe(0);
    const broken = {
      canvas: { width: 10, height: 10 },
      getImageData: () => {
        throw new Error("tainted");
      },
    } as unknown as CanvasRenderingContext2D;
    expect(alphaAt(broken, 1, 1)).toBe(0);
    expect(OPAQUE_ALPHA).toBe(20);
  });
});
