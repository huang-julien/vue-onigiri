# @vue-onigiri/compiler

Compiles a Vue template into an onigiri render function: a function that returns the serialized `VServerComponent` tree instead of VNodes.

```ts
import { compileOnigiri, compileOnigiriInline } from "@vue-onigiri/compiler";

const { code } = compileOnigiri(`<Counter v-load-client />`, {
  importMap: new Map([["Counter", "/components/Counter.vue"]]),
});
```

The emitted code imports its runtime helpers from `@vue-onigiri/core/runtime/*`. The Vite plugins in [vue-onigiri](../core) wire this compiler into SFC processing; most projects never call it directly.
