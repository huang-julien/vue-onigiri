# vue-onigiri 🍙

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/vue-onigiri?color=yellow)](https://npmjs.com/package/vue-onigiri)
[![npm downloads](https://img.shields.io/npm/dm/vue-onigiri?color=yellow)](https://npm.chart.dev/vue-onigiri)

<!-- /automd -->

Vue Onigiri brings React Server Components-style rendering to Vue. Components render on the server into a transferable AST; the client deserializes that AST back into VNodes, and only components marked with `v-load-client` ship their JS to the browser.

## Installation

```sh
npm install vue-onigiri
# or: pnpm add vue-onigiri / yarn add vue-onigiri / bun add vue-onigiri
```

## Quick Start

### 1. Configure Vite

```js
// vite.config.js
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriPlugins } from "vue-onigiri";

export default defineConfig({
  plugins: [vue(), onigiriPlugins()],
});
```

### 2. Mark client-loaded components

Add `v-load-client` to any component that should hydrate on the client. The component **must** be statically imported in the same SFC (or registered through `additionalImports` / the Nuxt module). Relative, aliased (`@/`, `~/`), extension-less, and package imports all resolve - the compiler goes through the bundler's own resolver:

```vue
<template>
  <div>
    <h1>Rendered on the server</h1>
    <Counter v-load-client />
  </div>
</template>

<script setup>
import Counter from "./Counter.vue";
</script>
```

The compiler reads the import and inlines `/components/Counter.vue` into the serialized payload. Components without `v-load-client` are rendered on the server and inlined - their source never reaches the browser.

### 3. Serialize on the server

```js
import { serializeApp } from "vue-onigiri/runtime/serialize";
import { createSSRApp } from "vue";
import App from "./App.vue";

const app = createSSRApp(App);
const data = await serializeApp(app, undefined, { url: req.url });
// send `data` to the client (inlined in HTML, JSON endpoint, etc.)
```

### 4. Render on the client

```js
import { renderOnigiri } from "vue-onigiri/runtime/deserialize";
import { createApp } from "vue";

const app = createApp({
  setup: () => () => renderOnigiri(data),
});
app.mount("#app");
```

Wrap the mount point in `<Suspense>` if your tree contains `v-load-client` components - each loader uses its own internal `<Suspense>`, but a top-level boundary keeps the initial render hydration-safe.

## Vite Plugins

### `onigiriPlugins(options?)`

The recommended entry point: returns every plugin below in working order (source capture (pre), scan, compiler (post), manifest). Its options are the compiler and manifest options combined:

```ts
interface OnigiriPluginsOptions extends OnigiriCompilerOptions, OnigiriManifestPluginOptions {
  /**
   * Scans SFC templates for `v-load-client` targets at `buildStart`, so the
   * manifest's `"auto"` includes are complete before any environment builds.
   *
   * @default true
   */
  scan?: boolean | OnigiriScanOptions;
}
```

The individual plugins stay exported for hosts that need custom placement:

- `onigiriSourceCapturePlugin()`: `enforce: 'pre'` tap recording each bare `.vue` module's pipeline source, so the compiler sees host pre-transforms instead of the pristine file on disk. Register it after host pre-transforms (order within `pre` is array order).
- `onigiriScanPlugin(options?)`: `buildStart` pre-pass scanning SFC templates for `v-load-client` targets, so the manifest's `"auto"` includes are complete before any environment builds.
- `onigiriCompilerPlugin(options?)`: the codegen, compiling the per-SFC `__onigiriRender` and wiring it into each SFC module.
- `onigiriManifestPlugin(options?)`: emits the `virtual:onigiri/manifest` module the runtime loader imports.

### `onigiriScanPlugin(options?)`

```ts
interface OnigiriScanPluginOptions extends OnigiriScanOptions {
  /**
   * Decides whether a tag is a native custom element and should be emitted
   * as plain HTML instead of being resolved as a component, like Vue's
   * `isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Registers components the SFC doesn't import statically, so
   * `v-load-client` can resolve them (Nuxt auto-imports, globals). A getter
   * is re-evaluated on every transform.
   */
  additionalImports?: AdditionalImportsOption;
}

interface OnigiriScanOptions {
  /**
   * Limits the scan to these directories, absolute or relative to the Vite root.
   *
   * @default ["."]
   */
  include?: string[];
  /** Skips these directory names during the scan, on top of the built-in defaults. */
  exclude?: string[];
}
```

### `onigiriCompilerPlugin(options?)`

Generates the per-SFC `__onigiriRender` function from each `<template>`. This is the only plugin doing real codegen work.

```ts
interface OnigiriCompilerOptions {
  /**
   * Emits a source map for the generated render function.
   *
   * @default true
   */
  sourceMap?: boolean;
  /**
   * Decides whether a tag is a native custom element and should be emitted
   * as plain HTML instead of being resolved as a component, like Vue's
   * `isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Registers components the SFC doesn't import statically, so
   * `v-load-client` can resolve them (Nuxt auto-imports, globals). A getter
   * is re-evaluated on every transform.
   */
  additionalImports?: AdditionalImportsOption;
  /**
   * Bakes a public chunk URL into the AST in place of the root-relative
   * source path of a `v-load-client` target.
   *
   * @remarks Returning `undefined` keeps the source path for runtime resolution.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
}

type AdditionalImportInput = string | { path: string; export?: string };

/** User-facing `additionalImports` shapes accepted by the compiler and scan plugins. */
type AdditionalImportsOption =
  | Record<string, AdditionalImportInput>
  | Map<string, AdditionalImportInput>
  | (() => Record<string, AdditionalImportInput> | Map<string, AdditionalImportInput>);
```

### `onigiriManifestPlugin(options?)`

Emits the `virtual:onigiri/manifest` virtual module that the runtime loader imports. It exposes an `importFn(src, exportName?)` that resolves a root-relative `.vue` path via `import.meta.glob`.

```ts
/**
 * Glob selection for one manifest environment: explicit patterns, or
 * `"auto"` for the scanned `v-load-client` targets, alone or in an array.
 *
 * @remarks `false` disables the glob.
 */
type OnigiriManifestInclude = "auto" | string | string[] | false;

interface OnigiriManifestPluginOptions {
  /**
   * Selects which source files the server manifest can load.
   *
   * @default "auto"
   */
  serverInclude?: OnigiriManifestInclude;
  /**
   * Selects which source files the client manifest can load.
   *
   * @remarks `false` means a source-path descriptor reaching the browser needs a custom `importFn`.
   * @default false
   */
  clientInclude?: OnigiriManifestInclude;
  /**
   * Adds literal loader entries, consulted before the glob, for chunk references a glob cannot express, typically package components. Keys are AST chunk references, values are bundler-resolved specifiers.
   */
  extraEntries?: Record<string, string>;
  /**
   * Emits a manifest without `import.meta.glob` in every environment, for bundlers that can't preprocess it or compile `.vue` imports, such as Nitro's pure-Node rollup.
   *
   * @default false
   */
  stub?: boolean;
}
```

#### Package components (`extraEntries`)

A `v-load-client` target imported from a package (`some-ui-lib/Button.vue`) can't be covered by the manifest glob: bare specifiers aren't valid `import.meta.glob` patterns, and in a built app a runtime `import()` of a bare specifier has no bundler behind it. `extraEntries` fixes this by emitting a literal `"key": () => import("spec")` into the manifest, so each environment's bundler resolves the specifier and emits its chunk (browser chunk in the client build, SSR chunk in the server build):

```ts
onigiriManifestPlugin({
  extraEntries: {
    "some-ui-lib/Button.vue": "some-ui-lib/Button.vue",
  },
});
```

- **Only needed for package components.** Project files are covered by the glob; dev doesn't strictly need entries either (the dev server resolves bare specifiers on demand), but the option is applied in dev too so behavior matches the build.
- **Key**: the chunk reference as it appears in the AST - for package components the compiler bakes the source specifier (`some-ui-lib/Button.vue`), or the URL the host baked via `resolveChunkUrl`. Lookup tolerates a leading-slash difference (`some-ui-lib/Button.vue` also matches `/some-ui-lib/Button.vue`), so one canonical key is enough; any other prefixing (e.g. an assets-dir prefix) must be registered as its own key or stripped by the host before lookup.
- **Values go through bundler resolution**, so aliased specifiers work too.
- **Packages shipping raw `.vue` files must be `ssr.noExternal`** (e.g. `ssr: { noExternal: ["some-ui-lib"] }`): an externalized entry leaves a runtime `import()` of a `.vue` file that Node cannot load.
- Under `stub: true` the entries are dropped along with the glob, for the same reason stub exists: those bundlers can't compile `.vue` imports.
- With `"auto"` includes, scanned package targets that no entry covers are excluded from the glob and reported via a debug-level plugin log naming the specifier.

## How It Works

1. **Compile time** - `onigiriCompilerPlugin` generates a per-SFC `__onigiriRender` function. For `<X v-load-client />`, the chunk path is resolved from the SFC's static imports (or `additionalImports`) and embedded as a literal string. Unresolvable targets fail compilation with an explicit error.
2. **Server render** - `serializeApp` walks the rendered tree. Server components inline as HTML/AST; client components emit a marker `[Component, props, chunkPath, exportName, slots]`.
3. **Client render** - `renderOnigiri` recreates the VNode tree. Each `Component` marker mounts a loader that wraps `defineAsyncComponent` in its own `<Suspense>`, so hydration matches the server's empty fallback before swapping in the real component.

```
Server: VNode tree → serialize → AST + client markers
Client: AST → deserialize → VNode tree (lazy chunks resolved via importFn)
```

## Limitations

- `v-load-client` requires compile-time path resolution: the target component must be statically imported in the SFC, or registered through `additionalImports`.
- `<component :is="x" v-load-client />` with a runtime `is` value isn't supported. the compiler can't resolve the path at build time. You need to use the `extraEntries` at compile time.
- Scoped slots can't be passed _into_ `v-load-client` components (the slot scope only exists on the client at runtime and can't be embedded in the frozen AST).

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

MIT - see `LICENSE`.

## Credits

- [@antfu](https://github.com/antfu) for naming this package 💖
