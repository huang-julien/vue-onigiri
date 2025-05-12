import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"
import { vueServerComponentsPlugin } from "./src/vite/chunk"

const { client, server } = vueServerComponentsPlugin({
    include: ['./test/fixtures/Counter.vue'],
})
export default defineConfig({
    // ssr: {},
    // build: {
    //     ssr: true
    // },
    plugins: [
        vue(),
        client,
        server
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
})