/// <reference types="vitest/config" />
import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { resolve } from "node:path";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Three pages: the pet window (index.html), the settings window (settings.html) and the --snapshot tool (snapshot.html, 12-windows-plan.md D13).
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        snapshot: resolve(process.cwd(), "snapshot.html"),
        settings: resolve(process.cwd(), "settings.html"),
        whatsnew: resolve(process.cwd(), "whatsnew.html"),
      },
    },
  },
  // Unit-test coverage of the logic (`npm run test:coverage`). Canvas drawing (render/), the settings DOM and the thin
  // Tauri/Web-API glue are left out: they are checked with the --snapshot previews and on the real desktop.
  test: {
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts", "src/app/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/app/platform.ts", "src/app/snapshot.ts", "src/app/debug.ts", "src/app/sound.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    // the "What's new" window bundles ../CHANGELOG.md (outside the app folder)
    fs: { allow: [".."] },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
