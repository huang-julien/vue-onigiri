import { fileURLToPath, URL } from "node:url";
import { ViteMcp } from "vite-plugin-mcp";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import { onigiriCompilerPlugin } from "../packages/core/src/vite/compiler";
import { onigiriManifestPlugin } from "../packages/core/src/vite/manifest";

// https://vite.dev/config/
export default defineConfig({
  plugins: [onigiriCompilerPlugin(), vue(), onigiriManifestPlugin(), vueDevTools(), ViteMcp()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  build: {
    minify: false,
  },
});
