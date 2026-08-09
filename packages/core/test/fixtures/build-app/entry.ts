// SSR entry for the production-build e2e: everything onigiri-related the
// test consumes (serialization + manifest importFn) comes from the built
// bundle, so the test exercises the compiled output, not the source.
import { serializeComponent } from "vue-onigiri/runtime/serialize";

import App from "./App.vue";

export function serialize() {
  return serializeComponent(App);
}

export { importFn } from "virtual:onigiri/manifest";
