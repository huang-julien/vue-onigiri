import { fileURLToPath, URL } from "node:url";
import { ViteMcp } from 'vite-plugin-mcp'
import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";
import { onigiriCompilerPlugin } from "../src/vite/compiler";
import { onigiriClientPlugin } from "../src/vite/chunk";
 

// https://vite.dev/config/
export default defineConfig({
  plugins: [    
    ...onigiriClientPlugin(), // Attach __chunk to SFC exports
    onigiriCompilerPlugin(), // Attach __onigiriRender to SFC exports
    vueDevTools(),
    ViteMcp()
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
