import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
    // ssr: {},
    // build: {
    //     ssr: true
    // },
    plugins: [
        vue()
    ],
    test: {
        environment: 'happy-dom',
        globals: true,
        pool: 'threads',
        environmentMatchGlobs: [
            ['packages/{vue,vue-compat,runtime-dom}/**', 'jsdom'],
        ],
        sequence: {
            hooks: 'list',
        },
    },
    mode: 'production',
 
})