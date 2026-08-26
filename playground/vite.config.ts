import { fileURLToPath, URL } from "node:url";
import { ViteMcp } from "vite-plugin-mcp";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import { onigiriPlugins } from "../packages/core/src/vite/plugins";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    onigiriPlugins({
      // Package component: a bare specifier the glob cannot cover; the
      // literal entry makes each environment's bundler emit its chunk.
      extraEntries: {
        "@vue-onigiri/test-ui-lib/Button.vue": "@vue-onigiri/test-ui-lib/Button.vue",
      },
    }),
    vueDevTools(),
    ViteMcp(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  build: {
    minify: false,
  },
});
