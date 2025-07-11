import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";
import { vueOnigiriPluginFactory } from "../src/vite/chunk";

const { client, server } = vueOnigiriPluginFactory({
  includeClientChunks: ["./src/components/HelloWorld.vue"],
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [client(), vueDevTools(), server()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  build: {
    minify: false,
  },
});
