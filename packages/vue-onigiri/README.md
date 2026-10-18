# vue-onigiri 🍙

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/vue-onigiri?color=yellow)](https://npmjs.com/package/vue-onigiri)
[![npm downloads](https://img.shields.io/npm/dm/vue-onigiri?color=yellow)](https://npm.chart.dev/vue-onigiri)

<!-- /automd -->

HTML-first Vue islands. An island renders once, with Vue's own SSR renderer. Components marked with `v-load-client` get nonce-bound comment markers around their output, and the client rebuilds a hydratable VNode tree straight from the DOM. Only the marked components ship their JS to the browser.

## Installation

```sh
npm install vue-onigiri
# or: pnpm add vue-onigiri / yarn add vue-onigiri / bun add vue-onigiri
```

## Entry points

| Import                 | Runs in             | Exports                                                                                                     |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `vue-onigiri`          | Browser             | `domToVNode`, `htmlToVNode`, `htmlToVNodes`, `onigiriPlugin`, `createImportFn`, the marker contract         |
| `vue-onigiri/server`   | SSR (Node, workers) | `provideMarkerNonce`, `ssrRenderClientComponent`, `ssrRenderClientVNode`, `ssrRenderTeleport`, marker types |
| `vue-onigiri/vite`     | Build time          | `onigiriPlugins` and each plugin on its own, `ssrLoadClientTransform`, `createOnigiriRegistry`              |
| `vue-onigiri/manifest` | Browser             | The loader's default `importFn` and `manifest`, plus `createImportFn`; replaced by the manifest plugin      |

The root entry never imports `vue/server-renderer` and only `vue-onigiri/vite` imports Vite, the Vue compilers or Node built-ins. Compiled SSR templates import their helpers from `vue-onigiri/server`.

## Quick Start

```js
// vite.config.js
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriPlugins } from "vue-onigiri/vite";

export default defineConfig({
  plugins: [vue(), onigiriPlugins()],
});
```

```vue
<!-- Island.vue: rendered on the server only -->
<template>
  <div>
    <h1>Rendered on the server</h1>
    <Counter v-load-client :start="1" />
  </div>
</template>

<script setup>
import Counter from "./Counter.vue";
</script>
```

```js
// server
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { provideMarkerNonce } from "vue-onigiri/server";

const context = provideMarkerNonce({});
const html = await renderToString(createSSRApp(Island), context);
// ship `html` and `context.onigiriNonce` to the client
```

```js
// client
import { createSSRApp, h, Suspense } from "vue";
import { domToVNode } from "vue-onigiri";

const el = document.querySelector("#island");
createSSRApp({
  render: () => h(Suspense, null, { default: () => domToVNode(el.firstChild, { nonce }) }),
}).mount(el);
```

## Server

### The transform, injected by the plugin

`onigiriPlugins()` (through `onigiriCompilerPlugin`) finds every `@vitejs/plugin-vue` instance in `configResolved` and appends `ssrLoadClientTransform` to its `template.compilerOptions.nodeTransforms`, keeping the transforms you already pass. Nothing has to be configured by hand.

In SSR compiles the transform rewrites:

- `_ssrRenderComponent(Comp, props, slots, _parent)` of a `v-load-client` component into `ssrRenderClientComponent(Comp, props, slots, _parent, when)`,
- `_ssrRenderVNode(_push, _createVNode(...), _parent)` of a dynamic `<component :is v-load-client>` into `ssrRenderClientVNode(...)`,
- every `_ssrRenderTeleport(...)` into the onigiri `ssrRenderTeleport(...)`, same arguments.

In client compiles it only drops the `v-load-client` directive, so no directive has to be registered. Hosts compiling templates without plugin-vue can import `ssrLoadClientTransform` from `vue-onigiri/vite` and add it to their own `nodeTransforms`.

### `provideMarkerNonce(context)`

Gives an SSR context a fresh 96-bit nonce under `onigiriNonce`, keeping one already set, and returns the context. Pass it to `renderToString`. Without a nonce in the SSR context, every helper is Vue's own call and the output is byte for byte what plain Vue renders, so a component used both inside islands and in regular pages compiles once.

The nonce must be generated on the server for each render, never taken from the request or reused from a cached context: anyone who knows it can forge markers through `v-html` or other raw HTML. A nonce you set yourself must be alphanumeric and at least 16 characters long, or `createMarkerSet` throws.

### `ssrRenderClientComponent`

Renders the component with `@vue/server-renderer`, waits for its async children, captures each slot's first render as HTML, and writes `<!--o:c:NONCE[...]-->` before and `<!--/o:c:NONCE-->` after Vue's own output. `v-load-client="false"` renders the component inline without markers. The chunk and export come from the `__onigiriDescriptor` the Vite plugin attaches to every SFC's default export in server builds (client bundles never carry it):

```ts
/**
 * Chunk reference the Vite plugin attaches to every SFC it compiles, read when marking it.
 */
export interface OnigiriDescriptor {
  /**
   * Chunk the client imports the component from, a root-relative source path, package specifier or baked URL.
   */
  chunk: string;
  /**
   * Export of that chunk holding the component.
   *
   * @default "default"
   */
  export?: string;
}
```

The chunk is the SFC's root-relative path (`/components/Counter.vue`), or the URL `resolveChunkUrl` returned for it. A file inside a package (under `node_modules`, or a workspace package outside the Vite root) gets its bare specifier, `<package name>/<path in package>`, which the manifest resolves through `extraEntries`. A component marked without a descriptor throws at render time.

### Teleports and Suspense

A `<Teleport>` in the island template writes `<!--o:t:NONCE[to, disabled, html]-->` right before Vue's `<!--teleport start-->`. The content HTML travels in the marker, so a refetched island mounts it into the target; Vue still fills `context.teleports`, so a host placing teleports for hydration keeps working. Disabled teleports omit the HTML, their content is inline. Teleports in a client component's own template are left to that component.

Suspense needs no marker: the island HTML only ever holds resolved content, since Vue's SSR renders the default branch and `ssrRenderClientComponent` waits for async children before writing its marker.

## Client

### `domToVNode(start, options)`, `htmlToVNode(html, options)`, `htmlToVNodes(html, options)`

- `domToVNode` rebuilds a hydratable tree from the island's DOM. Runs of marker-free DOM become static VNodes adopting the existing nodes, so the page app hydrates the island without re-rendering it.
- `htmlToVNode` does the same for refetched HTML. Pass the tree on screen as `previous`: static runs whose parsed DOM equals the current one keep their VNode, the others are replaced.
- `htmlToVNodes` returns sibling VNodes, used for slot HTML. Each static run carries its HTML, so it can mount or hydrate, then be cloned.

Each component marker becomes a `<Suspense>` around the loader, which imports the chunk and renders the component with the marker's props and slot HTML. Only comments carrying the nonce are markers; anything else, a forged `o:c[` in `v-html` included, stays a plain comment.

```ts
/**
 * Options for rebuilding an island VNode tree from existing HTML.
 */
export interface DomToVNodeOptions {
  /**
   * Nonce the server bound its markers to; comments without it stay plain comments.
   */
  nonce: string;
  /**
   * Resolves a client component from its marker's chunk and export name.
   */
  importFn?: ImportFn;
  /**
   * Makes static runs adopt the live DOM in place, as hydration needs.
   *
   * @default true
   * @remarks `false` suits a detached DOM, such as HTML parsed from a fetch; `htmlToVNode` always sets it.
   */
  adopt?: boolean;
  /**
   * Tree currently rendered for the island, whose static runs are kept where the new DOM is unchanged.
   */
  previous?: VNode;
}

/**
 * Resolves a client component from a marker's chunk reference and export name.
 */
export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>;
```

### Loader and manifest

The loader picks the first `importFn` of: the `importFn` option, the one provided app-wide by `app.use(onigiriPlugin, { importFn })` (from `vue-onigiri`), and the `importFn` of `vue-onigiri/manifest`. Slot HTML resolves its own markers through the same choice. A failed import is reported to `app.config.errorHandler` and renders nothing.

`vue-onigiri/manifest` is the override point. Published, it is a stub whose `importFn` throws with setup guidance. The manifest plugin resolves the exact id `vue-onigiri/manifest` (and the legacy `virtual:onigiri/manifest`) to a generated module, so the loader in `dist` picks it up with no further wiring; keep `vue-onigiri` out of dependency prebundling, which the compiler plugin's `optimizeDeps.exclude` already does. A host without the plugin aliases `vue-onigiri/manifest` to its own module exporting `importFn` and `manifest`, and can build them with `createImportFn` from `vue-onigiri`.

```ts
/**
 * Options of `onigiriPlugin`, the app-level fallback for every loader.
 */
export interface OnigiriPluginOptions {
  /**
   * Resolves client components for every island of the app that passes no `importFn` of its own.
   */
  importFn?: ImportFn;
}
```

The generated `importFn` resolves a chunk through the literal entries (`extraEntries` and the scanned `"auto"` targets), then the `import.meta.glob` of the include patterns, then a native `import()` for same-origin absolute URLs (the ones `resolveChunkUrl` bakes), and throws a diagnostic otherwise. It is built on first call, so importing the module runs nothing from the root entry.

## Marker contract

The HTML is Vue's own SSR output plus these comments, all bound to the render's nonce (alphanumeric and at least 16 characters, checked by `createMarkerSet`):

```html
<!--o:c:NONCE[1,{"start":1},"/components/Counter.vue","default",{"default":"<b>slot</b>"}]-->
<button>1</button>
<!--/o:c:NONCE-->

<!--o:t:NONCE["#modal",false,"<p>teleported</p>"]--><!--teleport start--><!--teleport end-->
```

The JSON is written by `encodeMarker`, which escapes `--` and `<` so it cannot close the comment. Both tuples are exported from `vue-onigiri`, and as types from `vue-onigiri/server`:

```ts
/**
 * Descriptor of a `v-load-client` component, carried by its `o:c` marker:
 * type tag, props without listeners, chunk, export name and slot HTML.
 */
export type OnigiriComponentMarker = [
  type: typeof COMPONENT_MARKER_TYPE,
  props: Record<string, any> | null,
  chunk: string,
  exportName?: string,
  slots?: Record<string, string>,
];

/**
 * Descriptor of a server-rendered teleport, carried by its `o:t` marker; `html` is omitted when disabled.
 */
export type OnigiriTeleportMarker = [to: string, disabled: boolean, html?: string];
```

Every prop passed to a `v-load-client` component is serialized into the marker, so it is readable in the page HTML; only `onX` listeners are left out. Pass nothing the browser must not see.

Slot HTML is captured on the slot's first invocation, so scoped slot props only vary per call on the server. Slot content may itself hold markers, which the loader resolves with the same nonce.

On the client, a nonce-bound comment is a marker only when its JSON decodes to a well-formed tuple; anything else stays a plain comment, both when walking and when matching a component's closing comment.

## Vite Plugins

### `onigiriPlugins(options?)`

Returns every plugin below in working order: scan (pre), compiler (post), manifest. The scan and the manifest share a target registry created for this call.

```ts
export interface OnigiriPluginsOptions
  extends
    OnigiriCompilerOptions,
    Omit<OnigiriManifestPluginOptions, "registry">,
    OnigiriScanResolveOptions {
  /**
   * Scans SFC templates for `v-load-client` targets at `buildStart`, so the
   * manifest's `"auto"` includes are complete before any environment builds.
   *
   * @default true
   */
  scan?: boolean | OnigiriScanOptions;
}
```

### `onigiriCompilerPlugin(options?)`

Injects `ssrLoadClientTransform` into plugin-vue and attaches the descriptor to each SFC. `resolveChunkUrl` returning `undefined` is the common case and keeps the source path; it never warns.

```ts
export interface OnigiriCompilerOptions {
  /**
   * Emits a source map for the descriptor attachment.
   *
   * @default true
   */
  sourceMap?: boolean;
  /**
   * Bakes a public chunk URL into the descriptor in place of the
   * root-relative source path of an SFC.
   *
   * @remarks Returning `undefined` keeps the source path for runtime resolution.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
}
```

### `onigiriScanPlugin(options?)`

Scans SFC templates for `v-load-client` targets at `buildStart`, and again for each SFC the dev server transforms, so the manifest's `"auto"` includes know every target.

```ts
/**
 * How the scan resolves a `v-load-client` tag to the file it registers.
 */
export interface OnigiriScanResolveOptions {
  /**
   * Decides whether a tag is a native custom element and should be emitted
   * as plain HTML instead of being resolved as a component, like Vue's
   * `isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Registers components the SFC doesn't import statically, so
   * `v-load-client` can resolve them (Nuxt auto-imports, globals). A getter
   * is re-evaluated on every scan.
   */
  additionalImports?: AdditionalImportsOption;
}

export interface OnigiriScanPluginOptions
  extends OnigiriScanOptions, OnigiriScanResolveOptions, OnigiriRegistryOption {}

export interface OnigiriScanOptions {
  /**
   * Limits the scan to these directories, absolute or relative to the Vite root.
   *
   * @default ["."]
   */
  include?: string[];
  /**
   * Skips these directory names during the scan, on top of the built-in defaults.
   */
  exclude?: string[];
}

/**
 * Component registered without a static import, such as a Nuxt auto-import or a global.
 */
export interface AdditionalImport {
  /**
   * File the component lives in, absolute or root-relative.
   */
  path: string;
}

/**
 * One `additionalImports` entry: the component file's path, bare or wrapped.
 */
export type AdditionalImportInput = string | AdditionalImport;

/**
 * User-facing `additionalImports` shapes accepted by the scan plugin.
 */
export type AdditionalImportsOption =
  | Record<string, AdditionalImportInput>
  | Map<string, AdditionalImportInput>
  | (() => Record<string, AdditionalImportInput> | Map<string, AdditionalImportInput>);
```

### `onigiriManifestPlugin(options?)`

Replaces the `vue-onigiri/manifest` stub the runtime loader imports with a generated module per environment. Scanned `"auto"` targets become literal `"/x.vue": () => import("/x.vue")` entries, so paths with glob characters (`/pages/[id].vue`, `/(group)/Foo.vue`) load as written; only explicit include patterns go through `import.meta.glob`.

```ts
/**
 * Glob selection for one manifest environment: explicit patterns, or
 * `"auto"` for the scanned `v-load-client` targets, alone or in an array.
 *
 * @remarks `false` disables the glob.
 */
export type OnigiriManifestInclude = "auto" | string | string[] | false;

export interface OnigiriManifestOptions {
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
   * Adds literal loader entries, consulted before the glob, for chunk
   * references a glob cannot express, typically package components. Keys are
   * marker chunk references, values are bundler-resolved specifiers.
   */
  extraEntries?: Record<string, string>;
}

export interface OnigiriManifestPluginOptions
  extends OnigiriManifestOptions, OnigiriRegistryOption {
  /**
   * Emits a manifest without `import.meta.glob` in every environment, for
   * bundlers that can't preprocess it or compile `.vue` imports, such as
   * Nitro's pure-Node rollup.
   *
   * @default false
   */
  stub?: boolean;
}
```

#### Target registry

The scan writes `v-load-client` targets to a registry and the manifest reads its `"auto"` includes from it. `onigiriPlugins` creates one per call. The standalone plugins default to one registry shared by the process, so a scan and a manifest wired separately still see each other; pass the same `createOnigiriRegistry()` to both to isolate them, as a host running several builds in one process should.

```ts
/**
 * Targets the scan registers and the manifest's `"auto"` includes read,
 * shared by one scan plugin and one manifest plugin.
 */
export interface OnigiriRegistry {
  /**
   * Records a `v-load-client` target, invalidating the manifest when it is new.
   */
  register: (sourcePath: string) => void;
  /**
   * Lists every registered target in registration order.
   */
  targets: () => readonly string[];
  /**
   * Sets the callback that invalidates the manifest module, replacing the previous one.
   */
  setInvalidator: (fn: () => void) => void;
}

/**
 * Option shared by the standalone scan and manifest plugins.
 */
export interface OnigiriRegistryOption {
  /**
   * Registry the scan writes `v-load-client` targets to and the manifest reads them from.
   *
   * @default a registry shared by every standalone plugin of the process
   */
  registry?: OnigiriRegistry;
}
```

#### Package components (`extraEntries`)

A `v-load-client` target from a package (`some-ui-lib/Button.vue`) can't be covered by the glob: bare specifiers aren't valid `import.meta.glob` patterns. `extraEntries` emits a literal `"key": () => import("spec")` into the manifest, so each environment's bundler resolves the specifier and emits its chunk:

```ts
onigiriManifestPlugin({
  extraEntries: {
    "some-ui-lib/Button.vue": "some-ui-lib/Button.vue",
  },
});
```

- **Key**: the chunk in the marker, the package specifier the descriptor carries. Lookup tolerates a leading-slash difference.
- **Values go through bundler resolution**, so aliased specifiers work too.
- **Packages shipping raw `.vue` files must be `ssr.noExternal`**, otherwise the SSR build leaves a runtime `import()` of a `.vue` file that Node cannot load.
- Under `stub: true` the entries are dropped along with the glob.
- With `"auto"` includes, scanned package targets that no entry covers are reported through a debug-level plugin log.

## Limitations

- `<component :is="x" v-load-client />` can't be scanned: list its possible targets in `clientInclude` or `extraEntries`.
- Slot HTML is captured once, so scoped slot props passed into a `v-load-client` component only vary on the server.
- Slot content rendered by a non-compiled parent (`slots.default()` in a render function) renders twice on the server, once for the marker.
- Every prop of a `v-load-client` component ends up in the page HTML, listeners excepted; secrets must not be passed as props.
- A chunk that fails to import renders nothing, so hydration drops the island's server DOM. A host that wants to keep or replace it handles the failure in a custom `importFn` (retry, fallback component) or in `app.config.errorHandler`.

## Development

```sh
pnpm install
pnpm dev          # interactive playground
pnpm test         # lint, vue-tsc, vitest
pnpm build        # build the package
pnpm lint         # oxlint + oxfmt
pnpm lint:fix
```

## License

MIT - see `LICENSE`.

## Credits

- [@antfu](https://github.com/antfu) for naming this package 💖
