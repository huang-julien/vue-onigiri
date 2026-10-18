import { it } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { provideMarkerNonce } from "../../src/server/ssr-boundary";
import Tree from "../fixtures/Tree.vue";
import Island from "../fixtures/Island.vue";
import IslandPlain from "../fixtures/Island.plain.vue";
import { ISLAND_CASES, ROW_COUNTS, type GeneratedCase, type GeneratedIslandCase } from "../shared";

interface IslandSizeRow {
  rows: number;
  every: number;
  /** Plain Vue SSR of the same tree, directives removed. */
  htmlBytes: number;
  htmlGzipBytes: number;
  /** Single-pass Vue SSR with markers. */
  htmlFirstBytes: number;
  htmlFirstGzipBytes: number;
}

const GENERATED_DIR = fileURLToPath(new URL("../client/generated/", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));

it("measures wire sizes and writes client fixtures", async () => {
  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  const islandSizes: IslandSizeRow[] = [];

  for (const rows of ROW_COUNTS) {
    const vueHtml = await renderToString(createSSRApp(Tree, { count: rows }));
    const generated: GeneratedCase = { rows, vueHtml };
    writeFileSync(`${GENERATED_DIR}${rows}.json`, JSON.stringify(generated));
  }

  for (const { rows, every } of ISLAND_CASES) {
    const current = await renderIsland({ count: rows, every });
    const next = await renderIsland({ count: rows, every, label: "next" });

    islandSizes.push({
      rows,
      every,
      htmlBytes: Buffer.byteLength(current.vueHtml),
      htmlGzipBytes: gzipSync(current.vueHtml).byteLength,
      htmlFirstBytes: Buffer.byteLength(current.htmlFirst),
      htmlFirstGzipBytes: gzipSync(current.htmlFirst).byteLength,
    });

    const generated: GeneratedIslandCase = {
      rows,
      every,
      vueHtml: current.vueHtml,
      htmlFirstHtml: current.htmlFirst,
      htmlFirstNonce: current.nonce,
      nextVueHtml: next.vueHtml,
      nextHtmlFirstHtml: next.htmlFirst,
      nextHtmlFirstNonce: next.nonce,
    };
    writeFileSync(`${GENERATED_DIR}island-${rows}.json`, JSON.stringify(generated));
  }

  writeFileSync(
    `${RESULTS_DIR}payload-size.json`,
    JSON.stringify({ nodeEnv: process.env.NODE_ENV, islandSizes }, null, 2),
  );
});

async function renderIsland(props: { count: number; every: number; label?: string }) {
  const vueHtml = await renderToString(createSSRApp(IslandPlain, props));
  const context = provideMarkerNonce({});
  const htmlFirst = await renderToString(createSSRApp(Island, props), context);
  return { vueHtml, htmlFirst, nonce: context.onigiriNonce };
}
