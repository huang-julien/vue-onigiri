import { bench, describe } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { provideMarkerNonce } from "../../src/server/ssr-boundary";
import Island from "../fixtures/Island.vue";
import IslandPlain from "../fixtures/Island.plain.vue";
import { ISLAND_CASES } from "../shared";

const BENCH_OPTIONS = { warmupIterations: 20, iterations: 100, time: 1000 };
// The plain baseline is `Island.vue` without its directives; the others compile through the transform.
for (const { rows, every } of ISLAND_CASES) {
  const props = { count: rows, every };

  describe(`ssr island rows=${rows} every=${every}`, () => {
    bench(
      "vue renderToString",
      async () => {
        await renderToString(createSSRApp(IslandPlain, props));
      },
      BENCH_OPTIONS,
    );

    // Outside an island render the helpers are Vue's own calls.
    bench(
      "vue renderToString(v-load-client, no nonce)",
      async () => {
        await renderToString(createSSRApp(Island, props));
      },
      BENCH_OPTIONS,
    );

    // Single pass: Vue's own SSR render, `v-load-client` writes the markers.
    bench(
      "vue renderToString(v-load-client markers)",
      async () => {
        await renderToString(createSSRApp(Island, props), provideMarkerNonce({}));
      },
      BENCH_OPTIONS,
    );
  });
}
