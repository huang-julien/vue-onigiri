# vue-onigiri monorepo 🍙

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/vue-onigiri?color=yellow)](https://npmjs.com/package/vue-onigiri)
[![npm downloads](https://img.shields.io/npm/dm/vue-onigiri?color=yellow)](https://npm.chart.dev/vue-onigiri)

<!-- /automd -->

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/huang-julien/vue-onigiri?utm_source=badge)

Vue Onigiri brings React Server Components-style rendering to Vue. An island renders once with Vue's own SSR renderer, components marked with `v-load-client` get nonce-bound comment markers, and the client rebuilds VNodes from the DOM. Only the marked components ship their JS to the browser.

## Motivation

This package has been created after multiple issues on maintaining [Nuxt Islands](https://nuxt.com/docs/4.x/api/components/nuxt-island) which uses HTML.

[Nuxt Islands](https://nuxt.com/docs/4.x/api/components/nuxt-island), when it comes to Slots and loading components within the island is quite complex to make it work.

Basically, you have to be aware of Vue's render mechanism. When the island, one of its slots or a client component within it is re-rendered, we have to trick re-teleport.

```mermaid
flowchart TB
  subgraph server [Server]
    A[Render island to HTML] --> B["Emit &lt;div data-island-slot&gt; placeholders"]
    B --> C[Render slots / client components separately]
    C --> D[Splice their HTML into the placeholders via regex]
    D --> E[Strip data-island-uid, store in payload]
  end
  subgraph client [Client]
    F[Re-stamp data-island-uid] --> G[Render HTML as createStaticVNode]
    G --> H["&lt;Teleport&gt; slots / client components into it<br/>target = CSS selector on data-island-slot"]
    H --> I{Island or slot re-renders?}
    I -- yes --> J["nextTick, then alternate the selector<br/>div[...] / [...] to force the Teleport diff"]
    J --> G
  end
  E --> F
```

Every step leans on how Vue's renderer, `<Teleport>` and static VNodes happen to behave, and each Vue release is a chance for one of them to break.

vue-onigiri removes the problem instead of patching it: slots and `v-load-client` components travel inside the HTML as comment markers, and the client turns that HTML into an ordinary VNode tree.

```mermaid
flowchart TB
  subgraph server [Server]
    A["Vue SSR render, once"] --> B["v-load-client components and teleports<br/>wrapped in nonce-bound comment markers"]
  end
  subgraph client [Client]
    C["domToVNode / htmlToVNode"] --> D[Render like any component]
    D --> E{Re-render?}
    E -- yes --> D
  end
  B --> C
```

## Entry points

One package, [`vue-onigiri`](packages/vue-onigiri), split by where the code runs:

| Import               | Runs in    | Description                                                 |
| -------------------- | ---------- | ----------------------------------------------------------- |
| `vue-onigiri`        | Browser    | DOM to VNode walker, loader plugin, marker contract         |
| `vue-onigiri/server` | SSR        | Nonce setup and the marker-writing render helpers           |
| `vue-onigiri/vite`   | Build time | Vite plugins and the `v-load-client` SSR template transform |

## License

MIT - see `LICENSE`.

## Credits

- [@antfu](https://github.com/antfu) for naming this package 💖
