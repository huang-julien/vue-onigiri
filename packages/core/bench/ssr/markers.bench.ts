import { bench, describe } from "vitest";
import { createSSRApp, type DefineComponent } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeComponent } from "../../src/runtime/serialize";
import { renderOnigiri } from "../../src/runtime/deserialize";
import { astToHtml, renderOnigiriWithMarkers } from "../../src/runtime/ast-to-html";
import { countHtmlRootNodes, neutralizeHtmlComments } from "../../src/runtime/html";
import { provideMarkerNonce } from "../../src/runtime/ssr-boundary";
import Tree from "../fixtures/Tree.vue";
import Island from "../fixtures/Island.vue";
import IslandHtmlFirst from "../fixtures/Island.html-first.vue";
import Counter from "../fixtures/Counter.vue";
import { ISLAND_CASES, ROW_COUNTS, withLoadClient } from "../shared";

const BENCH_OPTIONS = { warmupIterations: 20, iterations: 100, time: 1000 };

const OPTIONS = { importFn: async () => Counter as DefineComponent };

const TREE_PAYLOADS = new Map(
  await Promise.all(
    ROW_COUNTS.map(
      async (rows) => [rows, await serializeComponent(Tree, { count: rows })] as const,
    ),
  ),
);

const ISLAND_PAYLOADS = new Map(
  await Promise.all(
    ISLAND_CASES.map(
      async ({ rows, every }) =>
        [rows, await serializeComponent(Island, { count: rows, every })] as const,
    ),
  ),
);

// Same prebuilt AST for every projection, so only the HTML step is measured.
for (const rows of ROW_COUNTS) {
  const payload = TREE_PAYLOADS.get(rows)!;

  describe(`html projection rows=${rows}`, () => {
    bench(
      "onigiri astToHtml",
      () => {
        astToHtml(payload.ast);
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri renderToString(renderOnigiri)",
      async () => {
        await renderToString(createSSRApp({ render: () => renderOnigiri(payload) }));
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri renderToString(renderOnigiriWithMarkers)",
      async () => {
        await renderToString(createSSRApp({ render: () => renderOnigiriWithMarkers(payload) }));
      },
      BENCH_OPTIONS,
    );
  });
}

// Client components break the static runs, so markers cost more here than on `Tree.vue`.
for (const { rows, every } of ISLAND_CASES) {
  const payload = ISLAND_PAYLOADS.get(rows)!;
  const props = { count: rows, every };

  describe(`ssr island rows=${rows} every=${every}`, () => {
    bench(
      "vue renderToString",
      async () => {
        await renderToString(withLoadClient(createSSRApp(Island, props)));
      },
      BENCH_OPTIONS,
    );

    // Single pass: Vue's own SSR render, `v-load-client` writes the markers.
    bench(
      "vue renderToString(v-load-client markers)",
      async () => {
        await renderToString(createSSRApp(IslandHtmlFirst, props), provideMarkerNonce({}));
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri serializeComponent",
      async () => {
        await serializeComponent(Island, props);
      },
      BENCH_OPTIONS,
    );

    // The two-pass HTML-first path as a whole: serialize, then project the AST.
    bench(
      "onigiri serialize + renderToString(renderOnigiriWithMarkers)",
      async () => {
        const fresh = await serializeComponent(Island, props);
        await renderToString(
          createSSRApp({ render: () => renderOnigiriWithMarkers(fresh, OPTIONS) }),
        );
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri renderToString(renderOnigiri)",
      async () => {
        await renderToString(createSSRApp({ render: () => renderOnigiri(payload, OPTIONS) }));
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri renderToString(renderOnigiriWithMarkers)",
      async () => {
        await renderToString(
          createSSRApp({ render: () => renderOnigiriWithMarkers(payload, OPTIONS) }),
        );
      },
      BENCH_OPTIONS,
    );
  });
}

// Comment-free HTML takes the `includes` fast path; island HTML has a `<!---->` per plain row.
const TREE_HTML = astToHtml(TREE_PAYLOADS.get(10_000)!.ast);
const ISLAND_HTML = await renderToString(
  withLoadClient(createSSRApp(Island, { count: 10_000, every: 100 })),
);

describe("html helpers rows=10000", () => {
  bench(
    "neutralizeHtmlComments without comments",
    () => {
      neutralizeHtmlComments(TREE_HTML);
    },
    BENCH_OPTIONS,
  );

  bench(
    "neutralizeHtmlComments with comments",
    () => {
      neutralizeHtmlComments(ISLAND_HTML);
    },
    BENCH_OPTIONS,
  );

  bench(
    "countHtmlRootNodes",
    () => {
      countHtmlRootNodes(TREE_HTML);
    },
    BENCH_OPTIONS,
  );
});
