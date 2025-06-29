import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";
import { vueServerComponentsPlugin } from "../src/vite/chunk";

const { client, server } = vueServerComponentsPlugin({});

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
