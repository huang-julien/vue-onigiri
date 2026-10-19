import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";

/** Browser-side bench: Playwright Chromium, production Vue, same fixtures as the SSR bench. */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // No manifest plugin here, so the loader gets the stub, as an aliasing host would.
    alias: [
      {
        find: /^vue-onigiri\/manifest$/,
        replacement: fileURLToPath(new URL("src/manifest.ts", import.meta.url)),
      },
    ],
  },
  define: { __DEV__: "false" },
  mode: "production",
  test: {
    benchmark: { include: ["./bench/client/**/*.bench.ts"] },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
