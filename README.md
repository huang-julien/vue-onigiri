# vue-onigiri monorepo 🍙

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/vue-onigiri?color=yellow)](https://npmjs.com/package/vue-onigiri)
[![npm downloads](https://img.shields.io/npm/dm/vue-onigiri?color=yellow)](https://npm.chart.dev/vue-onigiri)

<!-- /automd -->

Vue Onigiri brings React Server Components-style rendering to Vue. Components render on the server into a transferable AST; the client deserializes that AST back into VNodes, and only components marked with `v-load-client` ship their JS to the browser.

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

vue-onigiri removes the problem instead of patching it: the server ships a **VNode AST**, not HTML. Slots and `v-load-client` components are ordinary nodes in that tree.

```mermaid
flowchart TB
  subgraph server [Server]
    A[Render component] --> B["Serialize VNode tree to AST<br/>slots and v-load-client markers are plain nodes"]
  end
  subgraph client [Client]
    C[Deserialize AST to VNodes] --> D[Render like any component]
    D --> E{Re-render?}
    E -- yes --> D
  end
  B --> C
```

This lead to different perf issue and maintainability issues.

Vue onigiri aims to fix theses issues by moving Static HTML to AST. Every VNode that can be described is serialized into AST and deserialized back into VNode.