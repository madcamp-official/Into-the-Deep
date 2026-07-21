import { defineConfig } from "vite";
import { resolve } from "node:path";

// Entry points: index.html is the existing dev/test harness
// (src/web/app/main.ts), product.html is the user-facing web UI
// (src/web/app/product-main.ts). electron-detector.html /
// electron-overlay.html are only ever loaded inside the Electron dev shell
// (see electron/main.cjs, electron/dev-launcher.js) — never linked from
// the web pages. Vite's dev server already serves all four paths with
// zero config; this only matters for `npm run build`.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        product: resolve(__dirname, "product.html"),
        electronDetector: resolve(__dirname, "electron-detector.html"),
        electronOverlay: resolve(__dirname, "electron-overlay.html"),
      },
    },
  },
});
