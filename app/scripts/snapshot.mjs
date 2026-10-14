// `npm run snapshot -- <out.png> [en|fa] [sheet|icon] [nunito|segoe] [--release] [--build]`
//
// Runs `ClaudeBuddy.exe --snapshot ...` (12-windows-plan.md D13). A debug exe loads its pages from the vite dev
// server, so this script starts vite, runs the exe, and stops vite again. `--release` runs the release exe instead
// (pages are embedded, no vite). `--build` runs `cargo build` first (debug) -- needed after Rust changes.
//
// Environment: CARGO_TARGET_DIR (default D:\dev\cargo-target) tells it where the exe is.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (positional.length === 0) {
  console.error("usage: npm run snapshot -- <out.png> [en|fa] [sheet|icon] [nunito|segoe] [--release] [--build]");
  process.exit(2);
}
const release = flags.includes("--release");
const out = resolve(positional[0]);
mkdirSync(dirname(out), { recursive: true });

const targetDir = process.env.CARGO_TARGET_DIR ?? "D:\\dev\\cargo-target";
const exe = join(targetDir, release ? "release" : "debug", "ClaudeBuddy.exe");

if (flags.includes("--build")) {
  const r = spawnSync("cargo", ["build", "--manifest-path", join(root, "src-tauri", "Cargo.toml")], {
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(exe)) {
  console.error(`${exe} not found (build it first: npm run snapshot -- <out> --build, or cargo build / tauri build)`);
  process.exit(2);
}

function portOpen(port) {
  return new Promise((done) => {
    const s = net.connect(port, "localhost");
    s.once("connect", () => (s.destroy(), done(true)));
    s.once("error", () => done(false));
  });
}

let vite = null;
function stopVite() {
  if (vite !== null && vite.pid !== undefined) {
    spawnSync("taskkill", ["/PID", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
    vite = null;
  }
}
process.on("exit", stopVite);
process.on("SIGINT", () => process.exit(130));

if (!release) {
  if (await portOpen(1420)) {
    console.error("port 1420 is already in use (a dev server is running?); stop it first");
    process.exit(2);
  }
  vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js")], {
    cwd: root,
    stdio: "ignore",
  });
  for (let i = 0; i < 100 && !(await portOpen(1420)); i++) await new Promise((r) => setTimeout(r, 200));
  if (!(await portOpen(1420))) {
    console.error("vite did not start");
    process.exit(1);
  }
}

const result = spawnSync(exe, ["--snapshot", out, ...positional.slice(1)], { stdio: "inherit" });
stopVite();
if (result.status !== 0) {
  console.error(`snapshot failed (exit ${result.status})`);
  process.exit(result.status ?? 1);
}
console.log(`wrote ${out}`);
