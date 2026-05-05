import { fileURLToPath, URL } from 'node:url'
import { ViteMcp } from 'vite-plugin-mcp'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import { onigiriCompilerPlugin } from '../src/vite/compiler'
import { onigiriManifestPlugin } from '../src/vite/manifest'

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
