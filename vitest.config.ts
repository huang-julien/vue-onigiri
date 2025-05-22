import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"
import { vueServerComponentsPlugin } from "./src/vite/chunk"

const { client, server } = vueServerComponentsPlugin({
    include: ['./test/fixtures/components/Counter.vue'],
})
export default defineConfig({
    plugins: [
        client()[1]!,
        server()
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
        include: [
            './test/**'
        ]
    },
})