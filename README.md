# vue-onigiri 🍙

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/vue-onigiri?color=yellow)](https://npmjs.com/package/vue-onigiri)
[![npm downloads](https://img.shields.io/npm/dm/vue-onigiri?color=yellow)](https://npm.chart.dev/vue-onigiri)

<!-- /automd -->

⚠️ **This is a proof of concept.**

Vue Onigiri brings React Server Components-style rendering to Vue. Components render on the server into a transferable AST; the client deserializes that AST back into VNodes, and only components marked with `v-load-client` ship their JS to the browser.

## Features

- **Server Components** — render on the server, send a serialized VNode tree to the client
- **Selective hydration** — only components tagged with `v-load-client` are loaded client-side
- **Slot support** — named and scoped slots survive serialization
- **Async / Suspense** — async components and `<Suspense>` boundaries are preserved
- **Bundler-agnostic** — works with Vite by default; `setOnigiriImportFn` lets you plug in any loader

## Installation

```sh
npm install vue-onigiri
# or: pnpm add vue-onigiri / yarn add vue-onigiri / bun add vue-onigiri
```

## Quick Start

### 1. Configure Vite

`onigiriPlugins()` returns the chunk-marker and manifest plugins together. Spread them into your config:

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { onigiriPlugins } from 'vue-onigiri'

export default defineConfig({
  plugins: [
    vue(),
    ...onigiriPlugins(),
  ],
})
```

### 2. Mark client-loaded components

Add `v-load-client` to any component that should hydrate on the client:

```vue
<template>
  <div>
    <h1>Rendered on the server</h1>
    <Counter v-load-client />
  </div>
</template>

<script setup>
import Counter from './Counter.vue'
</script>
```

Components without `v-load-client` are rendered on the server and inlined into the payload — their source never reaches the browser.

### 3. Serialize on the server

```js
import { serializeApp } from 'vue-onigiri/runtime/serialize'
import { createSSRApp } from 'vue'
import App from './App.vue'

const app = createSSRApp(App)
const data = await serializeApp(app, undefined, { url: req.url })
// send `data` to the client (inlined in HTML, JSON endpoint, etc.)
```

### 4. Render on the client

```js
import { renderOnigiri } from 'vue-onigiri/runtime/deserialize'
import { createApp } from 'vue'

const app = createApp({
  setup: () => () => renderOnigiri(data),
})
app.mount('#app')
```

Wrap the mount point in `<Suspense>` if your tree contains `v-load-client` components — each one resolves through its own internal `<Suspense>`, but a top-level boundary keeps the initial render hydration-safe.

## Vite Plugins

### `onigiriPlugins(options?)`

Convenience factory bundling both plugins below. Accepts the union of
`OnigiriChunkPluginOptions` (prefixed `registry*` to disambiguate) and
`OnigiriManifestPluginOptions`:

```ts
interface OnigiriPluginsOptions {
  registryInclude?: OnigiriChunkInclude // see below
  registryExclude?: string | RegExp | (string | RegExp)[]
  serverInclude?: string | false
  clientInclude?: string | false
  stub?: boolean
}
```

### `onigiriChunkPlugin(options?)`

Tags every matching Vue SFC export with `__chunk` (root-relative source path) and `__export` so the serializer knows where to point hydration markers. Each module also self-registers into `globalThis.__ONIGIRI_REGISTRY__`, which lets the manifest resolve components synchronously without a Vite-specific glob runtime.

```ts
interface OnigiriRegistryEntry {
  /** Root-relative path (e.g. `/components/Foo.vue`). Globs allowed. */
  path: string
  /** Whitelist of export names to register. Default: all. */
  exports?: string[]
}

type OnigiriChunkInclude
  = | string
    | RegExp
    | OnigiriRegistryEntry
    | (string | RegExp | OnigiriRegistryEntry)[]

interface OnigiriChunkPluginOptions {
  /**
   * What to register. Glob, RegExp, `{ path, exports? }` entry, or array
   * mixing any of those. Default: every `.vue` file.
   *
   * Use the structured `{ path, exports }` form to whitelist specific
   * files and (optionally) which named exports from each are loadable
   * via `v-load-client` / `importFn`.
   */
  include?: OnigiriChunkInclude
  /** Filter exclusions, matched after `include`. */
  exclude?: string | RegExp | (string | RegExp)[]
}
```

Examples:

```ts
// Glob — every .vue under /widgets/ self-registers, all exports.
onigiriChunkPlugin({ include: '/widgets/**/*.vue' })

// Explicit whitelist — only these two files, only their default exports.
onigiriChunkPlugin({
  include: [
    { path: '/components/Counter.vue', exports: ['default'] },
    { path: '/components/Modal.vue', exports: ['default', 'ModalHeader'] },
  ],
})

// Mixed — glob plus a single explicit override.
onigiriChunkPlugin({
  include: [
    '/widgets/**/*.vue',
    { path: '/special/MultiExport.vue', exports: ['PrintView'] },
  ],
})
```

### `onigiriManifestPlugin(options?)`

Emits the `virtual:onigiri/manifest` virtual module that the runtime loader imports. It resolves chunks first from the global registry, then optionally falls back to a Vite `import.meta.glob` lookup. The defaults are asymmetric — server gets a glob, client gets registry only — to avoid leaking project file paths into the browser bundle.

```ts
interface OnigiriManifestPluginOptions {
  /**
   * Glob (relative to root) for the **server** lazy-load fallback.
   * Default: `/**\/*.vue`. Set to `false` to disable.
   */
  serverInclude?: string | false
  /**
   * Glob for the **client** lazy-load fallback. Default: `false`
   * (registry only). Exposing `import.meta.glob` on the client leaks
   * every matching file path into the bundle and lets any browser
   * caller lazy-load arbitrary components — only enable this if you
   * have client components that aren't reachable through the static
   * import graph, and scope the glob as narrowly as possible.
   */
  clientInclude?: string | false
  /**
   * Force registry-only mode in **all** environments. Required for
   * bundlers that can't preprocess `import.meta.glob` or compile `.vue`
   * imports (e.g. Nitro's prerender rollup).
   */
  stub?: boolean
}
```

## API Reference

### `serializeApp(app, container?, ssrContext?)`

Serialize an entire Vue app instance.

```js
import { serializeApp } from 'vue-onigiri/runtime/serialize'

const data = await serializeApp(app, undefined, { url: '/page' })
```

### `serializeComponent(component, props?, slots?, ssrContext?)`

Serialize a single component without mounting an app.

```js
import { serializeComponent } from 'vue-onigiri/runtime/serialize'

const data = await serializeComponent(MyComponent, { title: 'Hello' })
```

### `renderOnigiri(data)`

Deserialize a payload back into a VNode tree.

```js
import { renderOnigiri } from 'vue-onigiri/runtime/deserialize'

const vnode = renderOnigiri(data)
```

### `setOnigiriImportFn(fn)`

Override how `v-load-client` components are loaded. Only needed when you can't use the Vite manifest plugin (custom bundlers, exotic SSR entrypoints).

```js
import { setOnigiriImportFn } from 'vue-onigiri/runtime/utils'

setOnigiriImportFn(async (src, exportName = 'default') => {
  const mod = await import(/* @vite-ignore */ src)
  return mod[exportName] ?? mod.default ?? mod
})
```

## How It Works

1. **Compile time** — the chunk plugin tags every SFC's default export with the source path it came from. The template compiler turns `v-load-client` into a serializable `Component` marker carrying that path.
2. **Server render** — `serializeApp` walks the rendered tree. Server components get inlined as HTML/AST; client components get a marker (`[Component, props, chunkPath, exportName, slots]`).
3. **Client render** — `renderOnigiri` recreates the VNode tree. Each `Component` marker mounts a loader that wraps `defineAsyncComponent` in its own `<Suspense>`, so hydration matches the server's empty fallback before swapping in the real component.

```
Server: VNode tree → serialize → AST + client markers
Client: AST → deserialize → VNode tree (lazy chunks resolved via manifest)
```

## Limitations

- Proof of concept — API is unstable, not production-ready.
- Scoped slots can't be passed *into* `v-load-client` components (the slot scope only exists on the client at runtime and can't be embedded in the frozen AST).
- Payload size grows with tree size; deeply server-rendered pages produce larger responses than equivalent SSR HTML.

## Development

```sh
pnpm install
pnpm dev          # interactive playground
pnpm test         # vitest
pnpm build        # build the library
pnpm lint         # eslint
pnpm lint:fix
```

## License

MIT — see `LICENSE`.

## Credits

- [@antfu](https://github.com/antfu) for naming this package 💖
