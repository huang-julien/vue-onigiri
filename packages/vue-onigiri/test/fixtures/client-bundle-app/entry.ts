// SSR entry for the client-bundle test: renders the island with a marker nonce.
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { provideMarkerNonce } from "vue-onigiri/server";

import App from "./App.vue";

export async function render() {
  const context = provideMarkerNonce({});
  return { html: await renderToString(createSSRApp(App), context), nonce: context.onigiriNonce };
}

export { importFn } from "vue-onigiri/manifest";
