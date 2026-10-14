// Bundled fonts (see text.ts for the choice): Nunito 500/600/800/900 (Latin rounded) and Vazirmatn (Persian, variable
// weight). Importing this file registers the @font-face rules; `loadFonts()` makes sure the faces are really loaded
// before the first canvas text is drawn (canvas never waits for a font by itself).

import "@fontsource/nunito/latin-500.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-800.css";
import "@fontsource/nunito/latin-900.css";
import "@fontsource-variable/vazirmatn";

import { FONT_FAMILIES, Weight } from "./text";

/// Sample text per face; it selects the right unicode-range subset file to download.
const SAMPLES: ReadonlyArray<[string, number, string]> = [
  [FONT_FAMILIES.latin, Weight.medium, "waiting for you · my-app"],
  [FONT_FAMILIES.latin, Weight.semibold, "✓ my-app"],
  [FONT_FAMILIES.latin, Weight.heavy, "Claude is done! z"],
  [FONT_FAMILIES.latin, Weight.black, "Knock!"],
  [FONT_FAMILIES.persian, Weight.heavy, "کار تموم شد! ۱۲۳"],
  [FONT_FAMILIES.persian, Weight.medium, "منتظرته · my-app"],
  [FONT_FAMILIES.persian, Weight.black, "تق!"],
];

export async function loadFonts(): Promise<void> {
  await Promise.all(SAMPLES.map(([family, weight, text]) => document.fonts.load(`${weight} 16px ${family}`, text)));
  await document.fonts.ready;
}
