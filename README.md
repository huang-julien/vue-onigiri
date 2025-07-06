# vue-onigiri 🍙

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/vue-onigiri?color=yellow)](https://npmjs.com/package/vue-onigiri)
[![npm downloads](https://img.shields.io/npm/dm/vue-onigiri?color=yellow)](https://npm.chart.dev/vue-onigiri)

<!-- /automd -->

⚠️ **This is a proof of concept.**

Vue Onigiri enables Vue Server Components by serializing and deserializing Vue component trees (VNodes). You can capture snapshots of Vue components either on the server or client side and reconstruct them on another client, allowing for server-side rendering patterns and component sharing between Vue applications.

## Features

- **Vue Server Components** - Render components on the server and send serialized VNodes to the client
- **VNode Serialization** - Serialize any Vue component tree into a transferable format
- **Cross-Application Sharing** - Share serialized components between different Vue applications
- **Slot Support** - Handles Vue slots and scoped slots in serialized components
- **Async Components** - Support for async components and Suspense boundaries

## Quick Start

### Installation

```sh
# npm
npm install vue-onigiri

# yarn
yarn add vue-onigiri

# pnpm
pnpm add vue-onigiri

# bun
bun add vue-onigiri
```

### Basic Usage

**Serializing a Component:**

```js
import { serializeComponent } from "vue-onigiri/runtime/serialize";
import MyComponent from "./MyComponent.vue";

// Serialize a component to transferable data
const serializedData = await serializeComponent(MyComponent, {
  message: "Hello from server!",
});

// Send this data to the client...
```

**Deserializing and Rendering:**

```js
import { renderOnigiri } from "vue-onigiri/runtime/deserialize";
import { createApp, h } from "vue";

// Receive serialized data from server
const app = createApp({
  setup() {
    return () => renderOnigiri(serializedData);
  },
});

app.mount("#app");
```

## Vite Integration

Vue Onigiri provides Vite plugins for both client and server environments:

### Client & Server Setup

```js
// vite.config.js
import { defineConfig } from "vite";
import { vueOnigiriPluginFactory } from "vue-onigiri";

const { client, server } = vueOnigiriPluginFactory({
  includeClientChunks: ["**/*.vue"], // Components to include as client chunks
  serverAssetsDir: "server-chunks",
  clientAssetsDir: "client-chunks",
});

export default defineConfig({
  plugins: [
    // Use client() for client build, server() for server build
    process.env.BUILD_TARGET === "server" ? server() : client(),
  ],
});
```

### Plugin Options

```typescript
interface VSCOptions {
  includeClientChunks: string[]; // Glob patterns for components to chunk
  rootDir?: string; // Root directory (default: cwd)
  vueServerOptions?: Options; // Vue plugin options for server
  serverAssetsDir?: string; // Server chunks directory
  clientAssetsDir?: string; // Client chunks directory
}
```

## API Reference

### Serialization

#### `serializeComponent(component, props?, context?)`

Serializes a Vue component with optional props and SSR context.

```js
import { serializeComponent } from "vue-onigiri/runtime/serialize";

const data = await serializeComponent(
  MyComponent,
  { title: "Hello" }, // Props
  { url: "/current-page" }, // SSR Context
);
```

#### `serializeApp(app, context?)`

Serializes an entire Vue application VNode.

```js
import { serializeApp } from "vue-onigiri/runtime/serialize";
import { createApp } from "vue";

const app = createApp(RootComponent);
const data = await serializeApp(app, { url: "/current-page" });
```

### Deserialization

#### `renderOnigiri(data, importFn?)`

Renders serialized VNode data back into actual VNodes.

```js
import { renderOnigiri } from "vue-onigiri/runtime/deserialize";

// Custom import function for loading components
// can be useful server side as client chunks are loaded by default
// made to be used by Nuxt
const customImportFn = (chunkPath) => import(chunkPath);

const vnode = renderOnigiri(serializedData, customImportFn);
```

## Component Types

Vue Onigiri handles different types of Vue components during serialization:

- **Elements** - Regular HTML elements with props and children
- **Components** - Vue components with props and slots
- **Text** - Text nodes
- **Fragments** - Vue fragments
- **Suspense** - Suspense boundaries for async components

## How It Works

1. **Serialization Phase**: Vue Onigiri traverses your component tree and converts VNodes into a serializable format
2. **Transfer**: The serialized data can be sent over the network (JSON, etc.)
3. **Deserialization Phase**: On the client, the data is reconstructed back into VNodes
4. **Hydration**: Vue renders the reconstructed VNodes as if they were created locally

```
Server Side:
VNode Tree → Serialize → JSON Data

Client Side:
JSON Data → Deserialize → VNode Tree → Render
```

## Testing

```sh
# Run all tests
pnpm test

# Run tests with coverage
pnpm test --coverage

# Run tests in watch mode
pnpm test --watch

# Run development playground
pnpm dev
```

## Limitations & Considerations

- **Proof of Concept**: This library is experimental and not recommended for production use
- **Bundle Size**: Serialized data can be large for complex component trees. Server-side components are duplicated to render VNodes

## Use Cases

- **Enhanced SSR**: Component-level caching for server-side rendering
- **Component sharing**: Distribute components between Vue applications
- **Static site generation**: Pre-render components and hydrate when needed
- **Micro-frontends**: Share Vue components across different applications
- **A/B testing**: Serve different component versions from the server

## Development

### Local Development

1. Clone this repository
2. Install latest LTS version of [Node.js](https://nodejs.org/en/)
3. Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
4. Install dependencies using `pnpm install`
5. Run interactive tests using `pnpm dev`

### Available Scripts

```sh
# Build the library
pnpm build

# Run development server with playground
pnpm dev

# Run linting
pnpm lint

# Fix linting issues
pnpm lint:fix

# Run tests
pnpm test

# Run tests with type checking
pnpm test:types

# Release new version
pnpm release
```

## License

<!-- automd:contributors license=MIT -->

Published under the [MIT](https://github.com/unjs/packageName/blob/main/LICENSE) license.
Made by [community](https://github.com/unjs/packageName/graphs/contributors) 💛
<br><br>
<a href="https://github.com/unjs/packageName/graphs/contributors">
<img src="https://contrib.rocks/image?repo=unjs/packageName" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->

## Credits

- @antfu for naming this package ! 💖
