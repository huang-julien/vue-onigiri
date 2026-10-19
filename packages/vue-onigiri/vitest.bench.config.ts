import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import codspeedPlugin from "@codspeed/vitest-plugin";
import { onigiriPlugins } from "./src/vite/plugins";
import { plainFixturePlugin } from "./bench/plain-fixtures";

const srcUrl = (rel: string) => fileURLToPath(new URL(`src/${rel}`, import.meta.url));

export default defineConfig({
  plugins: [plainFixturePlugin(), ...onigiriPlugins({ scan: false }), vue(), codspeedPlugin()],
  resolve: {
    alias: [
      { find: /^vue-onigiri$/, replacement: srcUrl("index.ts") },
      { find: /^vue-onigiri\/server$/, replacement: srcUrl("server.ts") },
    ],
  },
  test: {
    environment: "node",
    pool: "forks",
    env: {
      // Force production build for vue
      NODE_ENV: "production",
    },
    include: ["./bench/**/*.measure.ts"],
    benchmark: {
      include: ["./bench/**/*.bench.ts"],
    },
  },
  mode: "production",
});
