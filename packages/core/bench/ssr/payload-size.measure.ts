import { it } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeComponent } from "../../src/runtime/serialize";
import { renderOnigiri } from "../../src/runtime/deserialize";
import Tree from "../fixtures/Tree.vue";
import { ROW_COUNTS, type GeneratedCase } from "../shared";

interface SizeRow {
  rows: number;
  htmlBytes: number;
  htmlGzipBytes: number;
  payloadBytes: number;
  payloadGzipBytes: number;
}

const GENERATED_DIR = fileURLToPath(new URL("../client/generated/", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));

it("measures payload sizes and writes client fixtures", async () => {
  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  const sizes: SizeRow[] = [];

  for (const rows of ROW_COUNTS) {
    const vueHtml = await renderToString(createSSRApp(Tree, { count: rows }));
    const payload = await serializeComponent(Tree, { count: rows });
    const onigiriHtml = await renderToString(
      createSSRApp({ render: () => renderOnigiri(payload) }),
    );
    const payloadJson = JSON.stringify(payload);

    sizes.push({
      rows,
      htmlBytes: Buffer.byteLength(vueHtml),
      htmlGzipBytes: gzipSync(vueHtml).byteLength,
      payloadBytes: Buffer.byteLength(payloadJson),
      payloadGzipBytes: gzipSync(payloadJson).byteLength,
    });

    const generated: GeneratedCase = { rows, payload, vueHtml, onigiriHtml };
    writeFileSync(`${GENERATED_DIR}${rows}.json`, JSON.stringify(generated));
  }

  writeFileSync(
    `${RESULTS_DIR}payload-size.json`,
    JSON.stringify({ nodeEnv: process.env.NODE_ENV, sizes }, null, 2),
  );
});
