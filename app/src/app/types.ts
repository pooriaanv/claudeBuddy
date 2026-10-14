// Shared shapes of the Rust <-> page IPC (12-windows-plan.md section 3). Pure types: importable from tests.

/// `pointer_state()`: global physical px, primary button, seconds since the last keyboard / mouse input.
export interface PointerState {
  x: number;
  y: number;
  leftDown: boolean;
  idleSecs: number;
}

/// `pet-hover` event: cursor inside the pet window rect (window-relative physical px), or `inside: false` once on leaving.
export interface HoverEvent {
  inside: boolean;
  x: number;
  y: number;
}

/// `set_pet_level`: "desktop" = behind every normal window (idle), "front" = above everything (knocking).
export type PetLevel = "desktop" | "front";
