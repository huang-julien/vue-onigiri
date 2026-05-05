import { fileURLToPath, URL } from 'node:url'
import { ViteMcp } from 'vite-plugin-mcp'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import { onigiriCompilerPlugin } from '../vue-onigiri/src/vite/compiler'
import { onigiriManifestPlugin } from '../vue-onigiri/src/vite/manifest'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    onigiriCompilerPlugin(),
    onigiriManifestPlugin(),
    vueDevTools(),
    ViteMcp(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
  },
  build: {
    minify: false,
  },
})
