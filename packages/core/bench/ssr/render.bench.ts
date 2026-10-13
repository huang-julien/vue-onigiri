import { bench, describe } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeComponent } from "../../src/runtime/serialize";
import { renderOnigiri } from "../../src/runtime/deserialize";
import Tree from "../fixtures/Tree.vue";
import Nested from "../fixtures/Nested.vue";
import { ROW_COUNTS } from "../shared";

const BENCH_OPTIONS = { warmupIterations: 20, iterations: 100, time: 1000 };

for (const rows of ROW_COUNTS) {
  describe(`ssr rows=${rows}`, () => {
    bench(
      "vue renderToString",
      async () => {
        await renderToString(createSSRApp(Tree, { count: rows }));
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri serializeComponent",
      async () => {
        await serializeComponent(Tree, { count: rows });
      },
      BENCH_OPTIONS,
    );

    // What a hydrating setup pays on the server: AST first, then HTML from it.
    bench(
      "onigiri serialize + renderToString",
      async () => {
        const payload = await serializeComponent(Tree, { count: rows });
        await renderToString(createSSRApp({ render: () => renderOnigiri(payload) }));
      },
      BENCH_OPTIONS,
    );
  });
}

// Component boundaries dominate here: 4^6 leaves under 5461 component instances.
const NESTED = { depth: 6, width: 4 };

describe(`ssr nested depth=${NESTED.depth} width=${NESTED.width}`, () => {
  bench(
    "vue renderToString",
    async () => {
      await renderToString(createSSRApp(Nested, NESTED));
    },
    BENCH_OPTIONS,
  );

  bench(
    "onigiri serializeComponent",
    async () => {
      await serializeComponent(Nested, NESTED);
    },
    BENCH_OPTIONS,
  );
});
