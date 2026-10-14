import { it } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSSRApp, type DefineComponent } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeComponent } from "../../src/runtime/serialize";
import { renderOnigiri } from "../../src/runtime/deserialize";
import { renderOnigiriWithMarkers } from "../../src/runtime/ast-to-html";
import Tree from "../fixtures/Tree.vue";
import Island from "../fixtures/Island.vue";
import Counter from "../fixtures/Counter.vue";
import {
  ISLAND_CASES,
  ROW_COUNTS,
  withLoadClient,
  type GeneratedCase,
  type GeneratedIslandCase,
} from "../shared";

interface SizeRow {
  rows: number;
  htmlBytes: number;
  htmlGzipBytes: number;
  payloadBytes: number;
  payloadGzipBytes: number;
  /** Uncompressed HTML-first transport size. */
  markedHtmlBytes: number;
  /** Compressed HTML-first transport size. */
  markedHtmlGzipBytes: number;
}

interface IslandSizeRow extends Omit<SizeRow, "rows"> {
  rows: number;
  every: number;
}

const GENERATED_DIR = fileURLToPath(new URL("../client/generated/", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));

const OPTIONS = { importFn: async () => Counter as DefineComponent };

it("measures payload sizes and writes client fixtures", async () => {
  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  const sizes: SizeRow[] = [];
  const islandSizes: IslandSizeRow[] = [];

  for (const rows of ROW_COUNTS) {
    const vueHtml = await renderToString(createSSRApp(Tree, { count: rows }));
    const payload = await serializeComponent(Tree, { count: rows });
    const onigiriHtml = await renderToString(
      createSSRApp({ render: () => renderOnigiri(payload) }),
    );
    const onigiriMarkedHtml = await renderToString(
      createSSRApp({ render: () => renderOnigiriWithMarkers(payload) }),
    );

    sizes.push({ rows, ...measure(vueHtml, payload, onigiriMarkedHtml) });

    const generated: GeneratedCase = { rows, payload, vueHtml, onigiriHtml, onigiriMarkedHtml };
    writeFileSync(`${GENERATED_DIR}${rows}.json`, JSON.stringify(generated));
  }

  for (const { rows, every } of ISLAND_CASES) {
    const current = await renderIsland({ count: rows, every });
    const next = await renderIsland({ count: rows, every, label: "next" });

    islandSizes.push({ rows, every, ...measure(current.vueHtml, current.payload, current.marked) });

    const generated: GeneratedIslandCase = {
      rows,
      every,
      payload: current.payload,
      vueHtml: current.vueHtml,
      onigiriMarkedHtml: current.marked,
      nextPayload: next.payload,
      nextVueHtml: next.vueHtml,
      nextMarkedHtml: next.marked,
    };
    writeFileSync(`${GENERATED_DIR}island-${rows}.json`, JSON.stringify(generated));
  }

  writeFileSync(
    `${RESULTS_DIR}payload-size.json`,
    JSON.stringify({ nodeEnv: process.env.NODE_ENV, sizes, islandSizes }, null, 2),
  );
});

async function renderIsland(props: { count: number; every: number; label?: string }) {
  const vueHtml = await renderToString(withLoadClient(createSSRApp(Island, props)));
  const payload = await serializeComponent(Island, props);
  const marked = await renderToString(
    createSSRApp({ render: () => renderOnigiriWithMarkers(payload, OPTIONS) }),
  );
  return { vueHtml, payload, marked };
}

function measure(vueHtml: string, payload: unknown, markedHtml: string): Omit<SizeRow, "rows"> {
  const payloadJson = JSON.stringify(payload);
  return {
    htmlBytes: Buffer.byteLength(vueHtml),
    htmlGzipBytes: gzipSync(vueHtml).byteLength,
    payloadBytes: Buffer.byteLength(payloadJson),
    payloadGzipBytes: gzipSync(payloadJson).byteLength,
    markedHtmlBytes: Buffer.byteLength(markedHtml),
    markedHtmlGzipBytes: gzipSync(markedHtml).byteLength,
  };
}
