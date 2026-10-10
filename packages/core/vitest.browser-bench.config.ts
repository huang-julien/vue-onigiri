import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { playwright } from "@vitest/browser-playwright";

/** Browser-side bench: Playwright Chromium, production Vue, same fixtures as the SSR bench. */
export default defineConfig({
  plugins: [vue()],
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
