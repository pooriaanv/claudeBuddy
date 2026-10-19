// Builds the hook helper (app/notify, own crate) and copies it into src-tauri/resources for bundling (D10).
// macOS universal builds (`tauri build --target universal-apple-darwin`) get a universal helper: both
// architectures, joined with lipo. Another explicit macOS target builds the helper for that target.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const exe = process.platform === "win32" ? "buddy-notify.exe" : "buddy-notify";
const target = process.env.BUDDY_NOTIFY_TARGET_DIR ?? join(process.cwd(), "notify", "target");
const out = `src-tauri/resources/${exe}`;
const cargo = (...extra) =>
  execFileSync("cargo", ["build", "--release", "--manifest-path", "notify/Cargo.toml", "--target-dir", target, ...extra], {
    stdio: "inherit",
  });

mkdirSync("src-tauri/resources", { recursive: true });
// Set by the Tauri CLI for beforeBuildCommand.
const universal =
  process.env.TAURI_ENV_TARGET_TRIPLE === "universal-apple-darwin" || process.env.TAURI_ENV_ARCH === "universal";
if (universal) {
  const triples = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  for (const t of triples) cargo("--target", t);
  execFileSync("lipo", ["-create", "-output", out, ...triples.map((t) => join(target, t, "release", exe))], {
    stdio: "inherit",
  });
} else if (process.env.TAURI_ENV_TARGET_TRIPLE?.endsWith("-apple-darwin")) {
  const t = process.env.TAURI_ENV_TARGET_TRIPLE;
  cargo("--target", t);
  copyFileSync(join(target, t, "release", exe), out);
} else {
  cargo();
  copyFileSync(join(target, "release", exe), out);
}
console.log(`${exe}${universal ? " (universal)" : ""} -> src-tauri/resources/`);
