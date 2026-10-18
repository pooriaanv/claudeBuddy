// Builds the hook helper (app/notify, own crate) and copies it into src-tauri/resources for bundling (D10).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const exe = process.platform === "win32" ? "buddy-notify.exe" : "buddy-notify";
const target = process.env.BUDDY_NOTIFY_TARGET_DIR ?? join(process.cwd(), "notify", "target");
execFileSync("cargo", ["build", "--release", "--manifest-path", "notify/Cargo.toml", "--target-dir", target], { stdio: "inherit" });
mkdirSync("src-tauri/resources", { recursive: true });
copyFileSync(join(target, "release", exe), `src-tauri/resources/${exe}`);
console.log(`${exe} -> src-tauri/resources/`);
