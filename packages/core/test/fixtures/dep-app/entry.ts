import { serializeComponent } from "vue-onigiri/runtime/serialize";

import App from "./App.vue";

export function serialize() {
  return serializeComponent(App);
}
