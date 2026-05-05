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
- **Compile-time chunk resolution** — `v-load-client` paths are resolved during compilation, no runtime tagging required
- **Bundler-agnostic** — works with Vite by default; `provideOnigiriImportFn` lets you plug in any loader

## Installation

```sh
npm install vue-onigiri
# or: pnpm add vue-onigiri / yarn add vue-onigiri / bun add vue-onigiri
```

## Quick Start

### 1. Configure Vite

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { onigiriCompilerPlugin, onigiriManifestPlugin } from 'vue-onigiri'

export default defineConfig({
  plugins: [
    vue(),
    onigiriCompilerPlugin(),
    onigiriManifestPlugin(),
  ],
})
```

### 2. Mark client-loaded components

Add `v-load-client` to any component that should hydrate on the client. The component **must** be statically imported in the same SFC (or registered through `additionalImports` / the Nuxt module):

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

The compiler reads the import and inlines `/components/Counter.vue` into the serialized payload. Components without `v-load-client` are rendered on the server and inlined — their source never reaches the browser.

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

Wrap the mount point in `<Suspense>` if your tree contains `v-load-client` components — each loader uses its own internal `<Suspense>`, but a top-level boundary keeps the initial render hydration-safe.

## Vite Plugins

### `onigiriCompilerPlugin(options?)`

Generates the per-SFC `__onigiriRender` function from each `<template>`. This is the only plugin doing real codegen work.

```ts
interface OnigiriCompilerOptions {
  /** @default true */
  sourceMap?: boolean
  /**
   * Predicate for native custom elements / web components. Tags it
   * returns `true` for skip the Vue-component dispatch path and emit
   * as plain HTML. Mirrors Vue's `CompilerOptions.isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean
  /**
   * Tag → root-relative module path for components the SFC doesn't
   * import statically. Lets `v-load-client` resolve to the right
   * chunk for Nuxt auto-imports, globally-registered components, or
   * any other case the compiler can't see in `<script>`. Pass either
   * a static map or a getter (re-evaluated per transform).
   */
  additionalImports?:
    | Record<string, string>
    | Map<string, string>
    | (() => Record<string, string> | Map<string, string>)
}
```

### `onigiriManifestPlugin(options?)`

Emits the `virtual:onigiri/manifest` virtual module that the runtime loader imports. It exposes an `importFn(src, exportName?)` that resolves a root-relative `.vue` path via `import.meta.glob`.

```ts
interface OnigiriManifestPluginOptions {
  /**
   * Glob (relative to root) for the **server** lazy-load fallback.
   * Default: `/**\/*.vue`. Set to `false` to disable.
   */
  serverInclude?: string | false
  /**
   * Glob for the **client** lazy-load fallback. Default: `false`.
   * Exposing `import.meta.glob` to the browser leaks every matching
   * file path into the bundle, so the safer default is to require
   * `provideOnigiriImportFn` on the host app. Only set this if you
   * have client islands that aren't reachable through your app's
   * static import graph; scope it as narrowly as possible.
   */
  clientInclude?: string | false
  /**
   * Force a no-glob manifest in **all** environments. Required for
   * bundlers that can't preprocess `import.meta.glob` or compile
   * `.vue` imports (e.g. Nitro's prerender rollup).
   */
  stub?: boolean
}
```

## Nuxt

Nuxt integrates onigiri directly: wire is handled inside Nuxt core, which feeds its component registry into the compiler's `additionalImports` so auto-imported components work with `v-load-client` without further setup. No separate module to install.

## API Reference

### `serializeApp(app, slots?, ssrContext?)`

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

### `provideOnigiriImportFn(app, fn)`

Attach an app-scoped resolver for `v-load-client` chunks. Wins over the built-in manifest. Use this when:

- you need full control over how chunk paths map to modules (CDN-served bundles, federation, custom path normalization)
- you want a per-request (per-app) override that doesn't bleed across concurrent SSR

```js
import { provideOnigiriImportFn } from 'vue-onigiri/runtime/utils'

provideOnigiriImportFn(app, async (src, exportName = 'default') => {
  const mod = await myCustomLoader(src)
  return mod[exportName] ?? mod.default ?? mod
})
```

### `setOnigiriImportFn(fn)`

Module-scoped fallback resolver. Prefer `provideOnigiriImportFn` — `setOnigiriImportFn` is for non-Vite consumers (custom bundlers, exotic SSR entrypoints) where you can't get an app instance to inject onto.

```js
import { setOnigiriImportFn } from 'vue-onigiri/runtime/utils'

setOnigiriImportFn(async (src, exportName = 'default') => {
  const mod = await import(/* @vite-ignore */ src)
  return mod[exportName] ?? mod.default ?? mod
})
```

## How It Works

1. **Compile time** — `onigiriCompilerPlugin` generates a per-SFC `__onigiriRender` function. For `<X v-load-client />`, the chunk path is resolved from the SFC's static imports (or `additionalImports`) and embedded as a literal string. Unresolvable targets fail compilation with an explicit error.
2. **Server render** — `serializeApp` walks the rendered tree. Server components inline as HTML/AST; client components emit a marker `[Component, props, chunkPath, exportName, slots]`.
3. **Client render** — `renderOnigiri` recreates the VNode tree. Each `Component` marker mounts a loader that wraps `defineAsyncComponent` in its own `<Suspense>`, so hydration matches the server's empty fallback before swapping in the real component.

```
Server: VNode tree → serialize → AST + client markers
Client: AST → deserialize → VNode tree (lazy chunks resolved via importFn)
```

## Limitations

- Proof of concept — API is unstable, not production-ready.
- `v-load-client` requires compile-time path resolution: the target component must be statically imported in the SFC, or registered through `additionalImports` (Nuxt module handles this automatically for auto-imported components).
- `<component :is="x" v-load-client />` with a runtime `is` value isn't supported — the compiler can't resolve the path at build time.
- Components used outside an onigiri-compiled SFC (e.g. via Vue's vnode fallback path) can't carry `v-load-client`.
- Scoped slots can't be passed *into* `v-load-client` components (the slot scope only exists on the client at runtime and can't be embedded in the frozen AST).
- Payload size grows with tree size; deeply server-rendered pages produce larger responses than equivalent SSR HTML.

## Migrating from 0.2.x

`0.3` is a breaking change focused on shrinking the runtime surface:

- **Removed** `onigiriChunkPlugin` / `onigiriClientPlugin` / `onigiriServerPlugin` and the `onigiriPlugins()` factory. The chunk plugin's job (tagging SFCs with `__chunk` / `__export` and self-registering into `__ONIGIRI_REGISTRY__`) is gone — paths are now resolved at compile time.
- **Removed** the `OnigiriRegistryEntry` / `OnigiriChunkInclude` types and the `registryInclude` / `registryExclude` options.
- **Removed** runtime `Component.__chunk` / `Component.__export` reads. The compiler always inlines a literal path; if it can't, it errors at build time.
- **Added** `additionalImports` on `onigiriCompilerPlugin` — pass a map of `{ tag: path }` for components the SFC doesn't import statically.
- **Renamed** `src/vite/chunk.ts` → `src/vite/manifest.ts` (just an internal rename, not user-visible).

If your app worked because `onigiriChunkPlugin` was tagging components for you, the fix is one of:

1. Add a static `import` for the component in the SFC where you use `v-load-client`.
2. For Nuxt: upgrade to a Nuxt version that integrates onigiri directly (auto-imports work without further setup).
3. For globally-registered components: pass them through `onigiriCompilerPlugin({ additionalImports: { Foo: '/components/Foo.vue' } })`.

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
