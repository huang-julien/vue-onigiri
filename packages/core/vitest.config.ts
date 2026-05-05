import { defineConfig, defineProject } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { onigiriCompilerPlugin } from './src/vite/compiler'
import { onigiriManifestPlugin } from './src/vite/manifest'

const srcUrl = (rel: string) => fileURLToPath(new URL(`src/${rel}`, import.meta.url))

export default defineProject({
  plugins: [
    onigiriCompilerPlugin(),
    vue(),
    // Tests with `@vitest-environment happy-dom` run as `ssr: false`. Some
    // fixtures intentionally aren't statically imported, so they rely on
    // the glob fallback. Scope it to the fixtures directory rather than
    // the whole project.
    onigiriManifestPlugin({ clientInclude: '/test/fixtures/components/**/*.vue' }),
  ],
  resolve: {
    alias: {
      // Map the published package names that compiled output imports to
      // our local source so tests can run without a build step.
      'vue-onigiri/runtime/serialize': srcUrl('runtime/serialize.ts'),
      'vue-onigiri/runtime/deserialize': srcUrl('runtime/deserialize.ts'),
      'vue-onigiri/runtime/shared': srcUrl('runtime/shared.ts'),
      'vue-onigiri/runtime/utils': srcUrl('runtime/utils.ts'),
      'vue-onigiri/runtime/with-directive': srcUrl('runtime/with-directive.ts'),
      'vue-onigiri/runtime/render-slot': srcUrl('runtime/render-slot.ts'),
      'vue-onigiri/runtime/resolve-component': srcUrl('runtime/resolve-component.ts'),
      'vue-onigiri/runtime/loader': srcUrl('runtime/loader.ts'),
      'vue-onigiri/runtime/plugin': srcUrl('runtime/plugin.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['./test/**/*.test.ts'],
    pool: 'vmForks',
    setupFiles: ['./test/vitest.setup.ts'],
  },
  define: {
    'import.meta.hot.on': 'globalThis.mockedFn',
    'import.meta.hot.accept': 'globalThis.mockedFn',
  },
  mode: 'production',
})
