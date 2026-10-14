// port of `enum SkinCatalog` from Sources/ClaudeBuddy/Render/Skins/Skin.swift (Mac reference v0.0.9).
// Swift keeps it next to the protocol; here it is a separate file so skin.ts and the skins do not import each other.

import type { SkinID } from "../../core/pose";
import { BuddySkin } from "./buddy";
import { BunnySkin } from "./bunny";
import { KittySkin } from "./kitty";
import { PuppySkin } from "./puppy";
import { RoboSkin } from "./robo";
import { NinjaSkin } from "./ninja";
import { rgb } from "../paint";
import type { Skin } from "./skin";

/// Swift `SkinCatalog.skin(_:)`. Only Buddy exists in P0; the other six arrive in P2.
export function skinFor(id: SkinID): Skin {
  switch (id) {
    case "buddy":
      return new BuddySkin();
    case "kitty":
      return new KittySkin();
    case "puppy":
      return new PuppySkin();
    case "bunny":
      return new BunnySkin();
    case "robo":
      return new RoboSkin();
    case "ninja":
      return new NinjaSkin();
    case "cyberNinja":
      return new NinjaSkin(rgb(0.2, 0.88, 1.0));
    default:
      throw new Error(`skin "${id}" is not ported yet (P2)`);
  }
}
