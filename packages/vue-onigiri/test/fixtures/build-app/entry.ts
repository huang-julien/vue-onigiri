// SSR entry for the production-build e2e: rendering and the manifest importFn
// both come from the built bundle, so the test exercises the compiled output.
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { provideMarkerNonce } from "vue-onigiri/server";

import App from "./App.vue";

export async function render() {
  const context = provideMarkerNonce({});
  return { html: await renderToString(createSSRApp(App), context), nonce: context.onigiriNonce };
}

export { importFn } from "vue-onigiri/manifest";
