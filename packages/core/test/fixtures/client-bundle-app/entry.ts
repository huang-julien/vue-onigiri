// SSR entry for the client-bundle test: the server build must still carry
// the onigiri render and the server-only component the client build drops.
import { serializeComponent } from "vue-onigiri/runtime/serialize";

import App from "./App.vue";

export function serialize() {
  return serializeComponent(App);
}
